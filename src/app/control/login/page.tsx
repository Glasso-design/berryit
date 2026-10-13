import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabaseConfigured } from "@/lib/supabase/config";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Logga in – BERRYiT Control Center",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/control/login">) {
  const sp = await searchParams;
  const next = typeof sp?.next === "string" ? sp.next : "/control";

  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <header className="flex h-16 items-center justify-between px-5 sm:px-8">
        <Logo className="h-8 w-auto" priority />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="w-full max-w-md">
          <p className="font-mono text-xs tracking-[0.2em] text-signal uppercase">Control Center</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Logga in</h1>
          <p className="mt-2 text-muted">
            BERRYiT Control Center är inte öppet för registrering. Konton skapas av BERRYiT.
          </p>

          {supabaseConfigured ? (
            <LoginForm next={next} />
          ) : (
            <p className="mt-8 rounded-2xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
              Backend är inte konfigurerad: <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span> och{" "}
              <span className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> saknas.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
