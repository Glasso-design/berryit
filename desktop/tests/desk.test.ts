import { describe, expect, it } from "vitest";
import { hasActiveDeskEntitlement, safeRustDeskId } from "@berryit/shared/desk";

const org = "a";
const right = { id: "1", organization_id: org, product_key: "onarly_desk", entitlement: "remote_support", expires_at: null, revoked_at: null };

describe("ONARLY DESK visnings- och överlämningsregler", () => {
  it("accepterar bara aktiv rättighet för vald organisation", () => {
    expect(hasActiveDeskEntitlement([right], org)).toBe(true);
    expect(hasActiveDeskEntitlement([right], "b")).toBe(false);
    expect(hasActiveDeskEntitlement([{ ...right, revoked_at: "2026-01-01" }], org)).toBe(false);
    expect(hasActiveDeskEntitlement([{ ...right, expires_at: "2026-01-01" }], org, Date.parse("2026-02-01"))).toBe(false);
    expect(hasActiveDeskEntitlement([{ ...right, product_key: "onarly_ai" }], org)).toBe(false);
  });

  it("släpper aldrig vidare en URL eller kommando som RustDesk-ID", () => {
    expect(safeRustDeskId("123456789")).toBe("123456789");
    for (const value of ["rustdesk://123456789", "https://example.test", "123 456", "123456;calc", "12345", "123456789\n"]) {
      expect(safeRustDeskId(value)).toBeNull();
    }
  });
});
