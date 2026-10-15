import { useEffect, useState } from "react";
import { displayName, roleLabel } from "@berryit/shared/domain";
import { useSession } from "@/auth/session";
import { appInfo, saveConfig, type AppInfo } from "@/platform";
import { ConfigError, validateConfig } from "@/config";
import { checkBackendReachable } from "@/auth/client";

/**
 * Konto, behörigheter och anslutning.
 *
 * Här visas bara sådant som går att belägga: användarens egna uppgifter ur
 * databasen, appens version från Tauri och ett anslutningstest som faktiskt
 * anropar backenden.
 */
export function Installningar() {
  const { access, config, setConfig, session } = useSession();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [backendUrl, setBackendUrl] = useState(config?.backendUrl ?? "");
  const [anonKey, setAnonKey] = useState(config?.anonKey ?? "");
  const [controlUrl,setControlUrl]=useState(config?.controlUrl??"");
  const [status, setStatus] = useState<string | null>(null);
  const [fel, setFel] = useState<string | null>(null);

  useEffect(() => {
    appInfo().then(setInfo);
  }, []);

  const test = async () => {
    setFel(null);
    setStatus("Testar anslutningen…");
    const svar = await checkBackendReachable(backendUrl.replace(/\/+$/, ""));
    setStatus(svar.ok ? "Backenden svarar." : null);
    if (!svar.ok) setFel(svar.reason);
  };

  const spara = async () => {
    setFel(null);
    setStatus(null);
    try {
      const giltig = validateConfig({ backendUrl, anonKey,controlUrl });
      await saveConfig(giltig);
      setConfig(giltig);
      setStatus("Anslutningen sparad.");
    } catch (e) {
      setFel(e instanceof ConfigError ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Inställningar</h1>
      </header>

      <section className="rounded-2xl border border-line bg-ink-2 p-6">
        <h2 className="font-display text-lg font-semibold">Mitt konto</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Namn</dt>
            <dd>{access ? displayName(access) : "–"}</dd>
          </div>
          <div>
            <dt className="text-muted">E-post</dt>
            <dd>{access?.email ?? "–"}</dd>
          </div>
          <div>
            <dt className="text-muted">Roll</dt>
            <dd>{access ? roleLabel(access) : "–"}</dd>
          </div>
          <div>
            <dt className="text-muted">Autentiseringsnivå</dt>
            <dd>
              {access?.currentLevel ?? "–"}
              {access?.currentLevel === "aal2" ? " (tvåfaktor verifierad)" : ""}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-line bg-ink-2 p-6">
        <h2 className="font-display text-lg font-semibold">Mina behörigheter</h2>
        {access && access.grants.length > 0 ? (
          <ul className="mt-4 space-y-2 text-sm">
            {access.grants.map((g, i) => (
              <li key={`${g.role_key}-${i}`} className="flex items-center justify-between">
                <span className="font-mono text-xs">{g.role_key}</span>
                <span className="text-muted">
                  {g.scope === "global" ? "global" : `organisation ${g.organization_id ?? "?"}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">Inga supporttilldelningar.</p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-ink-2 p-6">
        <h2 className="font-display text-lg font-semibold">Anslutning</h2>
        <p className="mt-2 text-sm text-muted">
          Klienten ansluter direkt till BERRYiT:s egen backend. Endast den publika anon-nyckeln
          används – en service-role-nyckel avvisas.
        </p>
        <label className="mt-5 block text-sm">
          <span className="text-muted">Backend-URL</span>
          <input
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            spellCheck={false}
            className="mt-2 w-full rounded-xl border border-field bg-ink px-4 py-2.5 font-mono text-sm text-paper focus:border-berry focus:outline-none"
          />
        </label>
        <label className="mt-4 block text-sm">
          <span className="text-muted">Anon-nyckel</span>
          <input
            value={anonKey}
            onChange={(e) => setAnonKey(e.target.value)}
            spellCheck={false}
            className="mt-2 w-full rounded-xl border border-field bg-ink px-4 py-2.5 font-mono text-xs text-paper focus:border-berry focus:outline-none"
          />
        </label>
        <label className="mt-4 block text-sm">Control Center-URL (för kundregistrering)<input type="url" value={controlUrl} onChange={event=>setControlUrl(event.target.value)} className="mt-2 w-full rounded-xl border border-field bg-ink px-4 py-2.5 text-paper"/></label>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={test}
            className="rounded-full border border-line px-5 py-2 text-sm hover:border-field"
          >
            Testa anslutning
          </button>
          <button
            type="button"
            onClick={spara}
            className="rounded-full bg-berry px-5 py-2 text-sm font-semibold text-white hover:bg-berry-deep"
          >
            Spara
          </button>
        </div>
        {status && <p className="mt-4 text-sm text-signal">{status}</p>}
        {fel && (
          <p role="alert" className="mt-4 text-sm text-berry-2">
            {fel}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-ink-2 p-6">
        <h2 className="font-display text-lg font-semibold">Om appen</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Version</dt>
            <dd className="font-mono text-xs">{info?.version ?? "–"}</dd>
          </div>
          <div>
            <dt className="text-muted">Plattform</dt>
            <dd className="font-mono text-xs">{info?.platform ?? "–"}</dd>
          </div>
          <div>
            <dt className="text-muted">Sessionslagring</dt>
            <dd>
              {info?.secure_storage
                ? "Windows Credential Manager"
                : "Minne (utvecklingsläge utanför Tauri)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Token förnyas automatiskt</dt>
            <dd>{session ? "Ja" : "–"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
