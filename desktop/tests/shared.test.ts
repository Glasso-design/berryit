/*
 * Enhetstester för den delade logiken. Reglerna här avgör vad gränssnittet
 * visar i båda klienterna, så de testas en gång och gäller båda.
 */
import { describe, expect, it } from "vitest";
import {
  activeGrants,
  buildAccessContext,
  isStaff,
  isSuperAdmin,
  needsMfa,
  roleLabel,
  SUPER_ADMIN_ROLE_KEY,
  TICKET_REFERENCE_PATTERN,
} from "@berryit/shared/domain";
import type { Profile } from "@berryit/shared/domain";
import { controlNav, navFor, navItem } from "@berryit/shared/nav";
import { MODULE_REQUIREMENTS, ticketSearchFilter } from "@berryit/shared/api";
import { backendUrlSchema, looksLikeServiceRoleKey, totpCodeSchema } from "@berryit/shared/schemas";

const kund: Profile = {
  id: "1",
  role: "customer",
  full_name: "Kund Kundsson",
  email: "kund@example.test",
  organization_id: "org-1",
  is_org_admin: false,
};
const tekniker: Profile = { ...kund, id: "2", role: "technician", organization_id: null };
const admin: Profile = { ...kund, id: "3", role: "admin", organization_id: null };

describe("behörigheter", () => {
  it("kund är varken personal eller super admin", () => {
    expect(isStaff(kund, [])).toBe(false);
    expect(isSuperAdmin(kund, [])).toBe(false);
  });

  it("tekniker är personal", () => {
    expect(isStaff(tekniker, [])).toBe(true);
    expect(isSuperAdmin(tekniker, [])).toBe(false);
  });

  it("global super admin-tilldelning ger super admin", () => {
    const grants = [{ role_key: SUPER_ADMIN_ROLE_KEY, scope: "global" as const, organization_id: null }];
    expect(isSuperAdmin(kund, grants)).toBe(true);
  });

  it("samma roll begränsad till en organisation ger inte global super admin", () => {
    const grants = [
      { role_key: SUPER_ADMIN_ROLE_KEY, scope: "organization" as const, organization_id: "org-1" },
    ];
    expect(isSuperAdmin(kund, grants)).toBe(false);
    expect(isStaff(kund, grants)).toBe(true);
  });

  it("återkallade och utgångna tilldelningar räknas inte", () => {
    const nu = Date.parse("2026-10-13T12:00:00Z");
    const rader = [
      { role_key: "A", scope: "global" as const, organization_id: null, revoked_at: "2026-10-01T00:00:00Z" },
      { role_key: "B", scope: "global" as const, organization_id: null, expires_at: "2026-10-12T00:00:00Z" },
      { role_key: "C", scope: "global" as const, organization_id: null, expires_at: "2026-12-01T00:00:00Z" },
      { role_key: "D", scope: "global" as const, organization_id: null },
    ];
    expect(activeGrants(rader, nu).map((g) => g.role_key)).toEqual(["C", "D"]);
  });
});

describe("MFA-krav", () => {
  const ctx = (profile: Profile, level: string | null) =>
    buildAccessContext({
      userId: profile.id,
      email: profile.email,
      profile,
      grants: [],
      currentLevel: level,
      nextLevel: null,
    });

  it("super admin utan aal2 måste göra MFA", () => {
    expect(needsMfa(ctx(admin, "aal1"))).toBe(true);
    expect(needsMfa(ctx(admin, null))).toBe(true);
  });

  it("super admin med aal2 släpps in", () => {
    expect(needsMfa(ctx(admin, "aal2"))).toBe(false);
  });

  it("tekniker tvingas inte till MFA", () => {
    expect(needsMfa(ctx(tekniker, "aal1"))).toBe(false);
  });
});

describe("rolletikett", () => {
  const ctx = (profile: Profile, grants = [] as never[]) =>
    buildAccessContext({
      userId: profile.id,
      email: profile.email,
      profile,
      grants,
      currentLevel: "aal1",
      nextLevel: null,
    });

  it("namnger rollerna", () => {
    expect(roleLabel(ctx(admin))).toBe("Super Admin");
    expect(roleLabel(ctx(tekniker))).toBe("Tekniker");
    expect(roleLabel(ctx({ ...kund, is_org_admin: true }))).toBe("Kundkontakt");
    expect(roleLabel(ctx(kund))).toBe("Kund");
  });
});

describe("navigation", () => {
  it("har tio moduler", () => {
    expect(controlNav).toHaveLength(10);
  });

  it("kunder ser bara moduler som inte är personalvyer", () => {
    const meny = navFor(false);
    expect(meny.map((i) => i.key)).toEqual(["dashboard", "support", "installningar"]);
  });

  it("personal ser alla moduler", () => {
    expect(navFor(true)).toHaveLength(10);
  });

  it("varje ej ansluten modul beskriver vad som saknas", () => {
    for (const item of controlNav.filter((i) => !i.connected)) {
      const krav = MODULE_REQUIREMENTS[item.key];
      expect(krav, `saknar krav för ${item.key}`).toBeDefined();
      expect(krav.requirements.length).toBeGreaterThan(0);
    }
  });

  it("okänd nyckel ger fel i stället för tom vy", () => {
    expect(() => navItem("finns-inte" as never)).toThrow();
  });
});

describe("sökning", () => {
  it("söker på både referens och ämne", () => {
    expect(ticketSearchFilter("skrivare")).toBe(
      "reference.ilike.%skrivare%,subject.ilike.%skrivare%",
    );
  });

  it("tar bort tecken som bryter PostgREST-filtret", () => {
    expect(ticketSearchFilter("a%b,c(d)")).toBe("reference.ilike.%abcd%,subject.ilike.%abcd%");
  });

  it("känner igen ärendereferenser", () => {
    expect(TICKET_REFERENCE_PATTERN.test("BIT-2026-0021")).toBe(true);
    expect(TICKET_REFERENCE_PATTERN.test("BIT-26-21")).toBe(false);
  });
});

describe("engångskod", () => {
  it("accepterar sex siffror och rensar mellanslag", () => {
    expect(totpCodeSchema.parse(" 123 456 ")).toBe("123456");
  });

  it("avvisar fel längd och bokstäver", () => {
    expect(totpCodeSchema.safeParse("12345").success).toBe(false);
    expect(totpCodeSchema.safeParse("12345a").success).toBe(false);
  });
});

describe("backend-URL", () => {
  it("accepterar https", () => {
    expect(backendUrlSchema.parse("https://support.berryit.se/")).toBe("https://support.berryit.se");
  });

  it("accepterar klartext mot loopback och Tailscale", () => {
    // Tailscale delar ut adresser i 100.64.0.0/10. Testet prövar intervallet,
    // inte en bestämd värd – ingen infrastrukturadress hör hemma i koden.
    expect(backendUrlSchema.safeParse("http://127.0.0.1:8700").success).toBe(true);
    expect(backendUrlSchema.safeParse("http://100.64.0.1:8700").success).toBe(true);
    expect(backendUrlSchema.safeParse("http://100.127.255.254:8700").success).toBe(true);
  });

  it("avvisar klartext mot adresser utanför Tailscale-intervallet", () => {
    expect(backendUrlSchema.safeParse("http://100.63.0.1:8700").success).toBe(false);
    expect(backendUrlSchema.safeParse("http://100.128.0.1:8700").success).toBe(false);
  });

  it("avvisar klartext mot internet", () => {
    expect(backendUrlSchema.safeParse("http://support.berryit.se").success).toBe(false);
    expect(backendUrlSchema.safeParse("ftp://support.berryit.se").success).toBe(false);
    expect(backendUrlSchema.safeParse("").success).toBe(false);
  });
});

describe("skydd mot service-role-nyckel", () => {
  const jwt = (payload: object) =>
    `${btoa('{"alg":"HS256","typ":"JWT"}')}.${btoa(JSON.stringify(payload))}.signatur`;

  it("känner igen en service-role-nyckel", () => {
    expect(looksLikeServiceRoleKey(jwt({ role: "service_role" }))).toBe(true);
  });

  it("släpper igenom anon-nyckel", () => {
    expect(looksLikeServiceRoleKey(jwt({ role: "anon" }))).toBe(false);
  });

  it("kraschar inte på skräp", () => {
    expect(looksLikeServiceRoleKey("inte-en-jwt")).toBe(false);
    expect(looksLikeServiceRoleKey("a.b.c")).toBe(false);
  });
});
