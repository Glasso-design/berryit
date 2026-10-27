export const publicNames: readonly ["BERRYIT_PUBLIC_BACKEND_URL", "BERRYIT_PUBLIC_ANON_KEY", "BERRYIT_PUBLIC_CONTROL_URL"];
export type PublicName = typeof publicNames[number];
export function distributionProfile(input: Record<string, string | undefined>, kind?: string): Record<PublicName, string>;
export function packageKind(args: readonly string[]): "owner" | "generic";
