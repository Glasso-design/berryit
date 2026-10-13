import { useEffect, useState } from "react";
import { loginSchema } from "@berryit/shared/schemas";
import { checkBackendReachable } from "@/auth/client";
import { useSession } from "@/auth/session";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Inloggning mot BERRYiT:s egen backend (GoTrue).
 *
 * Felmeddelandet är medvetet generiskt så att det inte går att lista ut vilka
 * konton som finns. Nätverksfel skiljs från felaktiga uppgifter – en tekniker
 * utan Tailscale ska inte tro att lösenordet är fel.
 */
export function Login() {
  const { signIn, config } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fel, setFel] = useState<string | null>(null);
  const [pagar, setPagar] = useState(false);
  const [uppkoppling, setUppkoppling] = useState<"okand" | "ok" | "nere">("okand");

  useEffect(() => {
    if (!config) return;
    const styr = new AbortController();
    const timer = setTimeout(() => styr.abort(), 8000);
    checkBackendReachable(config.backendUrl, styr.signal).then((svar) => {
      clearTimeout(timer);
      setUppkoppling(svar.ok ? "ok" : "nere");
    });
    return () => {
      clearTimeout(timer);
      styr.abort();
    };
  }, [config]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFel(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFel(parsed.error.issues[0]?.message ?? "Kontrollera uppgifterna.");
      return;
    }
    setPagar(true);
    const svar = await signIn(parsed.data.email, parsed.data.password);
    setPagar(false);
    if (svar.error) {
      // Skilj nätverksfel från fel lösenord innan meddelandet visas.
      const nat = config ? await checkBackendReachable(config.backendUrl) : { ok: true as const };
      setFel(nat.ok ? svar.error : nat.reason);
      setUppkoppling(nat.ok ? "ok" : "nere");
    }
  };

  return (
    <div className="grid h-full place-items-center bg-ink px-6 text-paper">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <Logo className="h-8 w-auto" />
        <p className="mt-6 font-mono text-xs tracking-[0.2em] text-signal uppercase">
          Control Center
        </p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">Logga in</h1>
        <p className="mt-2 text-sm text-muted">
          Konton skapas av BERRYiT. Det finns ingen registrering här.
        </p>

        {uppkoppling === "nere" && (
          <p
            role="status"
            className="mt-5 rounded-xl border border-line bg-ink-2 px-4 py-3 text-sm text-muted"
          >
            Ingen kontakt med backenden. Kontrollera nätverket eller Tailscale innan du loggar in.
          </p>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="text-muted">E-post</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border border-field bg-ink px-4 py-3 text-paper focus:border-berry focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Lösenord</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-xl border border-field bg-ink px-4 py-3 text-paper focus:border-berry focus:outline-none"
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
            {pagar ? "Loggar in…" : "Logga in"}
          </button>
        </form>
      </div>
    </div>
  );
}
