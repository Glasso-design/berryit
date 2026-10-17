import { useState } from "react";
import { checkBackendReachable } from "@/auth/client";
import { BUILD_DEFAULTS, ConfigError, validateConfig } from "@/config";
import { saveConfig } from "@/platform";
import { useSession } from "@/auth/session";
import { Logo } from "@/components/Logo";

/**
 * Första start: klienten vet inte vilken backend den ska prata med.
 *
 * Vi visar ingen inloggning och ingen data förrän anslutningen är angiven och
 * verifierad – ett tomt skal hade sett ut som om systemet vore nere.
 */
export function Setup({ onClose }: { onClose?: () => void }) {
  const { setConfig, config, error } = useSession();
  const [backendUrl, setBackendUrl] = useState(config?.backendUrl ?? BUILD_DEFAULTS.backendUrl ?? "");
  const [anonKey, setAnonKey] = useState(config?.anonKey ?? BUILD_DEFAULTS.anonKey ?? "");
  const [controlUrl,setControlUrl]=useState(config?.controlUrl ?? BUILD_DEFAULTS.controlUrl ?? "");
  const [fel, setFel] = useState<string | null>(null);
  const [pagar, setPagar] = useState(false);

  const spara = async (e: React.FormEvent) => {
    e.preventDefault();
    setFel(null);
    let giltig;
    try {
      giltig = validateConfig({ backendUrl, anonKey,controlUrl });
    } catch (e2) {
      setFel(e2 instanceof ConfigError ? e2.message : String(e2));
      return;
    }
    setPagar(true);
    try {
      const svar = await checkBackendReachable(giltig.backendUrl);
      if (!svar.ok) {
        setFel(svar.reason);
        return;
      }
      await saveConfig(giltig);
      setConfig(giltig);
      onClose?.();
    } catch {
      setFel("Anslutningen kunde inte sparas. Kontrollera inställningarna och försök igen.");
    } finally {
      setPagar(false);
    }
  };

  return (
    <div className="grid h-full place-items-center bg-ink px-6 text-paper">
      <div className="w-full max-w-md">
        <Logo className="h-8 w-auto" />
        <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight">
          Anslut till BERRYiT
        </h1>
        <p className="mt-2 text-sm text-muted">
          Ange adressen till BERRYiT:s backend och den publika anon-nyckeln. Uppgifterna får du av
          BERRYiT. Backenden nås över Tailscale – en service-role-nyckel ska aldrig användas här.
        </p>

        {error && <p className="mt-4 text-sm text-berry-2">{error}</p>}

        <form onSubmit={spara} className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="text-muted">Backend-URL</span>
            <input
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="https://support.berryit.se"
              spellCheck={false}
              className="mt-2 w-full rounded-xl border border-field bg-ink px-4 py-3 font-mono text-sm text-paper focus:border-berry focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Anon-nyckel</span>
            <input
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              spellCheck={false}
              className="mt-2 w-full rounded-xl border border-field bg-ink px-4 py-3 font-mono text-xs text-paper focus:border-berry focus:outline-none"
            />
          </label>

          <label className="block text-sm">Control Center-URL (för kundregistrering)<input value={controlUrl} onChange={event=>setControlUrl(event.target.value)} type="url" className="mt-2 w-full rounded-xl border border-field bg-ink px-4 py-3 text-paper"/></label>
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
            {pagar ? "Testar anslutningen…" : "Spara och anslut"}
          </button>
          {onClose && <button type="button" onClick={onClose} disabled={pagar} className="w-full rounded-full border border-line px-6 py-3 text-sm">Tillbaka till inloggning</button>}
        </form>
      </div>
    </div>
  );
}
