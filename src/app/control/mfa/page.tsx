import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { requireUser } from "@/lib/auth";
import { MfaFlow } from "./MfaFlow";

export const metadata: Metadata = { title: "Tvåfaktor – BERRYiT Control Center", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Tvåfaktorsteget. Super Admin måste nå aal2 innan någon administrativ vy
 * renderas – kontrollen görs i requireSession(), inte här i UI:t.
 */
export default async function MfaPage() {
  const ctx = await requireUser();
  if (ctx.currentLevel === "aal2") redirect("/control");

  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Logo className="h-8 w-auto" priority />
      </header>
      <main className="flex flex-1 items-start justify-center px-5 pb-16 sm:items-center">
        <div className="w-full max-w-md">
          <p className="font-mono text-xs tracking-[0.2em] text-signal uppercase">Säkerhet</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Tvåfaktor krävs</h1>
          <p className="mt-2 text-muted">
            {ctx.isSuperAdmin
              ? "Super Admin måste bekräfta med en engångskod innan Control Center öppnas."
              : "Bekräfta med en engångskod för att höja säkerheten på sessionen."}
          </p>
          <MfaFlow />
          <form action="/control/logout" method="post" className="mt-6">
            <button type="submit" className="text-sm text-muted underline-offset-4 hover:underline">
              Logga ut i stället
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
