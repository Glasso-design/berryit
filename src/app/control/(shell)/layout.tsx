import type { Metadata } from "next";
import { Shell, type ShellOrg } from "@/components/control/Shell";
import { displayName, requireSession, roleLabel } from "@/lib/auth";
import { navFor } from "@/lib/control-nav";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: { default: "Control Center – BERRYiT", template: "%s – BERRYiT Control Center" },
  description: "BERRYiT Control Center.",
  robots: { index: false, follow: false },
};

// Sessionen måste läsas per request.
export const dynamic = "force-dynamic";

export default async function ControlLayout({ children }: LayoutProps<"/control">) {
  // Kräver inloggning, och MFA för Super Admin, innan något renderas.
  const ctx = await requireSession();
  const supabase = await createSupabaseServerClient();

  // RLS avgör: personal ser alla organisationer, kunder bara sin egen.
  const { data: orgs } = await supabase.from("organizations").select("id, name").order("name").limit(100);

  return (
    <Shell
      nav={navFor(ctx.isStaff)}
      user={{
        name: displayName(ctx),
        email: ctx.email,
        role: roleLabel(ctx),
        mfa: ctx.currentLevel === "aal2",
      }}
      organizations={(orgs ?? []) as ShellOrg[]}
      canSearch
    >
      {children}
    </Shell>
  );
}
