import { useEffect, useRef, useState } from "react";
import { totpCodeSchema } from "@berryit/shared/schemas";
import { useSession } from "@/auth/session";
import { Logo } from "@/components/Logo";

type Steg =
  | { typ: "laddar" }
  | { typ: "registrera"; factorId: string; secret: string; uri: string | null }
  | { typ: "verifiera"; factorId: string }
  | { typ: "fel"; meddelande: string };

/**
 * Tvåfaktor (TOTP) för Super Admin.
 *
 * Samma krav som i webben: utan aal2 renderas ingen administrativ vy. Till
 * skillnad från webben sker anropen direkt från klienten med användarens egen
 * session – desktopappen har ingen server som kan göra det åt den.
 *
 * Observera att `listFactors().totp` bara innehåller bekräftade faktorer.
 * Obekräftade finns i `all`, och de måste städas bort innan en ny inskrivning
 * kan göras, annars krockar GoTrue på namnet.
 */
export function Mfa() {
  const { supabase, refresh, signOut } = useSession();
  const [steg, setSteg] = useState<Steg>({ typ: "laddar" });
  const [kod, setKod] = useState("");
  const [fel, setFel] = useState<string | null>(null);
  const [pagar, setPagar] = useState(false);
  const startad = useRef(false);

  useEffect(() => {
    if (!supabase || startad.current) return;
    startad.current = true;
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        setSteg({ typ: "fel", meddelande: error.message });
        return;
      }
      const totp = (data?.all ?? []).filter((f) => f.factor_type === "totp");
      const bekraftad = totp.find((f) => f.status === "verified");
      if (bekraftad) {
        setSteg({ typ: "verifiera", factorId: bekraftad.id });
        return;
      }
      for (const f of totp) {
        const bort = await supabase.auth.mfa.unenroll({ factorId: f.id });
        if (bort.error) {
          setSteg({ typ: "fel", meddelande: bort.error.message });
          return;
        }
      }
      const ny = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `BERRYiT Control Center ${new Date().toISOString()}`,
      });
      if (ny.error) {
        setSteg({ typ: "fel", meddelande: ny.error.message });
        return;
      }
      setSteg({
        typ: "registrera",
        factorId: ny.data.id,
        secret: ny.data.totp.secret,
        uri: ny.data.totp.uri ?? null,
      });
    })();
  }, [supabase]);

  const verifiera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || steg.typ === "laddar" || steg.typ === "fel") return;
    setFel(null);
    const parsed = totpCodeSchema.safeParse(kod);
    if (!parsed.success) {
      setFel(parsed.error.issues[0]?.message ?? "Ange den sexsiffriga koden.");
      return;
    }
    setPagar(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: steg.factorId,
      code: parsed.data,
    });
    setPagar(false);
    if (error) {
      setFel("Koden stämmer inte. Försök igen.");
      return;
    }
    await refresh();
  };

  return (
    <div className="grid h-full place-items-center bg-ink px-6 text-paper">
      <div className="w-full max-w-sm">
        <Logo className="h-8 w-auto" />
        <p className="mt-6 font-mono text-xs tracking-[0.2em] text-signal uppercase">Säkerhet</p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">Tvåfaktor krävs</h1>
        <p className="mt-2 text-sm text-muted">
          Super Admin måste bekräfta med en engångskod innan Control Center öppnas.
        </p>

        {steg.typ === "laddar" && <p className="mt-8 text-muted">Hämtar tvåfaktorstatus…</p>}

        {steg.typ === "fel" && (
          <p
            role="alert"
            className="mt-8 rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm"
          >
            Kunde inte starta tvåfaktor: {steg.meddelande}
          </p>
        )}

        {(steg.typ === "registrera" || steg.typ === "verifiera") && (
          <form onSubmit={verifiera} className="mt-8 space-y-5">
            {steg.typ === "registrera" && (
              <div className="rounded-2xl border border-line bg-ink-2 p-5">
                <p className="text-sm text-muted">
                  Lägg till BERRYiT Control Center i din autentiseringsapp och ange sedan koden.
                </p>
                <p className="mt-3 text-sm text-muted">Hemlighet:</p>
                <code className="mt-1 block rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm break-all">
                  {steg.secret}
                </code>
              </div>
            )}

            <label className="block">
              <span className="text-sm text-muted">Engångskod</span>
              <input
                value={kod}
                onChange={(e) => setKod(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                className="mt-2 w-full rounded-xl border border-field bg-ink px-4 py-3 text-center font-mono text-lg tracking-[0.3em] text-paper focus:border-berry focus:outline-none"
              />
            </label>

            {fel && (
              <p
                role="alert"
                className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm"
              >
                {fel}
              </p>
            )}

            <button
              type="submit"
              disabled={pagar}
              className="w-full rounded-full bg-berry px-6 py-3 font-semibold text-white transition hover:bg-berry-deep disabled:opacity-60"
            >
              {pagar ? "Verifierar…" : steg.typ === "registrera" ? "Aktivera tvåfaktor" : "Verifiera"}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-6 text-sm text-muted hover:text-paper"
        >
          Logga ut i stället
        </button>
      </div>
    </div>
  );
}
