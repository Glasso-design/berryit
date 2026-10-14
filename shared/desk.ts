/** Desktop display rules. Database RLS and triggers remain authoritative. */
export type DeskEntitlement = {
  id: string;
  organization_id: string;
  product_key: string;
  entitlement: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export function hasActiveDeskEntitlement(rows: DeskEntitlement[], organizationId: string, now = Date.now()): boolean {
  return rows.some((row) =>
    row.organization_id === organizationId &&
    row.product_key === "onarly_desk" &&
    row.entitlement === "remote_support" &&
    !row.revoked_at &&
    (!row.expires_at || Date.parse(row.expires_at) > now),
  );
}

/** An ID is copied as plain text; no URL scheme or automatic process launch. */
export function safeRustDeskId(value: string): string | null {
  return /^[0-9]{6,20}$/.test(value) ? value : null;
}
