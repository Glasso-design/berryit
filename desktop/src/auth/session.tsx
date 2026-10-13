/*
 * Sessionstillstånd för hela appen.
 *
 * Tillstånden är avsiktligt få och explicita, så att gränssnittet aldrig kan
 * visa en halvinloggad vy:
 *   laddar      – konfiguration och befintlig session läses in
 *   osatt       – ingen backend konfigurerad ännu
 *   utloggad    – ingen giltig session
 *   mfa         – inloggad men Super Admin saknar aal2
 *   klar        – inloggad med rätt nivå
 */
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { needsMfa } from "@berryit/shared/domain";
import type { AccessContext, Organization } from "@berryit/shared/domain";
import { loadAccessContext, loadOrganizations } from "./access";
import { getBackendClient, resetBackendClient } from "./client";
import { clearStorageCache } from "./secure-store";
import { loadConfig } from "@/platform";
import { isConfigured, validateConfig, type AppConfig } from "@/config";

export type SessionStatus = "laddar" | "osatt" | "utloggad" | "mfa" | "klar";

type SessionValue = {
  status: SessionStatus;
  config: AppConfig | null;
  supabase: SupabaseClient | null;
  session: Session | null;
  access: AccessContext | null;
  organizations: Organization[];
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setConfig: (config: AppConfig) => void;
};

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<SessionStatus>("laddar");
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<AccessContext | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => (config ? getBackendClient(config) : null), [config]);

  // Konfiguration läses en gång vid start.
  useEffect(() => {
    let avbruten = false;
    loadConfig()
      .then((stored) => {
        if (avbruten) return;
        if (!isConfigured(stored)) {
          setStatus("osatt");
          return;
        }
        setConfigState(validateConfig(stored));
      })
      .catch((e: unknown) => {
        if (avbruten) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("osatt");
      });
    return () => {
      avbruten = true;
    };
  }, []);

  const syncFrom = useCallback(
    async (client: SupabaseClient, aktiv: Session | null) => {
      setSession(aktiv);
      if (!aktiv) {
        setAccess(null);
        setOrganizations([]);
        setStatus("utloggad");
        return;
      }
      const ctx = await loadAccessContext(client);
      setAccess(ctx);
      if (!ctx) {
        setStatus("utloggad");
        return;
      }
      if (needsMfa(ctx)) {
        setOrganizations([]);
        setStatus("mfa");
        return;
      }
      setOrganizations(await loadOrganizations(client));
      setStatus("klar");
    },
    [],
  );

  // Befintlig session läses in och följs sedan via onAuthStateChange, som även
  // täcker automatisk förnyelse av access-token.
  useEffect(() => {
    if (!supabase) return;
    let avbruten = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!avbruten) void syncFrom(supabase, data.session ?? null);
      })
      .catch((fel: unknown) => {
        // Går sessionen inte att läsa ska appen visa inloggning, inte fastna i
        // uppstartsläget.
        console.warn("Kunde inte läsa sessionen vid start:", fel);
        if (!avbruten) {
          setSession(null);
          setAccess(null);
          setStatus("utloggad");
        }
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, aktiv) => {
      if (!avbruten) void syncFrom(supabase, aktiv);
    });

    return () => {
      avbruten = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase, syncFrom]);

  const signIn = useCallback<SessionValue["signIn"]>(
    async (email, password) => {
      if (!supabase) return { error: "Ingen backend konfigurerad." };
      try {
        const { error: fel } = await supabase.auth.signInWithPassword({ email, password });
        // Medvetet generiskt: avslöjar inte om kontot finns.
        if (fel) return { error: "Fel e-post eller lösenord." };
        return {};
      } catch (fel) {
        // Nätverk eller lagring som fallerar får inte lämna knappen i
        // "Loggar in…" för alltid.
        console.warn("Inloggningen gick inte att slutföra:", fel);
        return { error: "Inloggningen kunde inte slutföras. Kontrollera anslutningen och försök igen." };
      }
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    clearStorageCache();
    setSession(null);
    setAccess(null);
    setOrganizations([]);
    setStatus("utloggad");
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    await syncFrom(supabase, data.session ?? null);
  }, [supabase, syncFrom]);

  const setConfig = useCallback((next: AppConfig) => {
    resetBackendClient();
    clearStorageCache();
    setError(null);
    setStatus("laddar");
    setConfigState(next);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      config,
      supabase,
      session,
      access,
      organizations,
      error,
      signIn,
      signOut,
      refresh,
      setConfig,
    }),
    [status, config, supabase, session, access, organizations, error, signIn, signOut, refresh, setConfig],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSession måste användas inuti SessionProvider.");
  return value;
}
