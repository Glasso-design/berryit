import { describe, expect, it } from "vitest";
import { aiErrorMessage, isAiStructuredResponse } from "@berryit/shared/ai";
import { navItem } from "@berryit/shared/nav";

describe("Ask ONARLY AI contract", () => {
  const valid = {
    summary: "DNS-felet är belagt i ett tidigare ärende.",
    verifiedFacts: [{ text: "DNS misslyckades.", sourceIds: ["BIT-2026-0042"] }],
    hypotheses: [{ text: "Klientens DNS kan vara fel.", confidence: "medium" }],
    recommendedActions: [{ text: "Läs ipconfig /all.", risk: "read-only" }],
    missingInformation: ["Aktuell DNS-konfiguration."],
    sources: [
      {
        id: "BIT-2026-0042",
        kind: "ticket",
        title: "VPN tappar DNS",
        reference: "BIT-2026-0042",
      },
    ],
  };

  it("accepts a response whose verified facts cite returned sources", () => {
    expect(isAiStructuredResponse(valid)).toBe(true);
  });

  it("rejects a verified fact that cites a resource not returned by the server", () => {
    expect(
      isAiStructuredResponse({
        ...valid,
        verifiedFacts: [{ text: "Främmande data.", sourceIds: ["BIT-OTHER"] }],
      }),
    ).toBe(false);
  });

  it("keeps approval-required actions distinct from read-only diagnostics", () => {
    expect(
      isAiStructuredResponse({
        ...valid,
        recommendedActions: [
          { text: "Läs loggen.", risk: "read-only" },
          { text: "Starta om tjänsten.", risk: "approval-required" },
        ],
      }),
    ).toBe(true);
  });

  it("exposes Ask ONARLY AI as connected in Desktop only", () => {
    const item = navItem("ai");
    expect(item.label).toBe("Ask ONARLY AI");
    expect(item.connected).toBe(false);
    expect(item.desktopConnected).toBe(true);
  });

  it("maps safe server error codes to actionable Swedish messages", () => {
    expect(aiErrorMessage("GATEWAY_DISABLED")).toContain("inte konfigurerad");
    expect(aiErrorMessage("FORBIDDEN")).toContain("behörighet");
  });
});
