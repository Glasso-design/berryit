// Public packaging settings only. This is not backend authorization.
export const publicNames = ["BERRYIT_PUBLIC_BACKEND_URL", "BERRYIT_PUBLIC_ANON_KEY", "BERRYIT_PUBLIC_CONTROL_URL"];
function origin(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} kräver en säker origin.`); }
  const ip = url.hostname.split(".").map(Number);
  const privateHttp = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || (ip.length === 4 && ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && privateHttp))
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${label} måste vara en säker origin utan credentials eller sökväg.`);
  }
  return url.origin;
}
function publicKey(value) {
  if (value.startsWith("sb_secret_")) throw new Error("Administrativa nycklar får aldrig byggas in i Desktop.");
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(value)) return value;
  try {
    const pieces = value.split(".");
    const payload = JSON.parse(Buffer.from(pieces[1], "base64url").toString("utf8"));
    if (payload.role === "service_role") throw new Error("administrative");
    const header = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8"));
    if (pieces.length !== 3 || !pieces.every(piece => /^[A-Za-z0-9_-]+$/.test(piece))
      || !["HS256", "ES256", "RS256", "EdDSA"].includes(header.alg) || payload.role !== "anon"
      || (payload.exp !== undefined && (!Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000))) throw new Error("invalid");
    return value;
  } catch (error) {
    if (error.message === "administrative") throw new Error("Administrativa nycklar får aldrig byggas in i Desktop.");
    throw new Error("Ägarprofilen kräver en publik anon-nyckel eller publishable key med giltigt format.");
  }
}
export function distributionProfile(input, kind = "owner") {
  if (!["owner", "generic", "development"].includes(kind)) throw new Error("Okänd distributionstyp.");
  const values = Object.fromEntries(publicNames.map(name => [name, String(input[name] ?? "").trim()]));
  if (kind === "generic") return Object.fromEntries(publicNames.map(name => [name, ""]));
  if (kind === "development" && publicNames.every(name => !values[name])) return values;
  if (!values.BERRYIT_PUBLIC_BACKEND_URL || !values.BERRYIT_PUBLIC_ANON_KEY) {
    throw new Error("Ägarpaket kräver en fullständig profil med backend-origin och publik klientnyckel. Använd explicit --generic för ett paket utan anslutning.");
  }
  values.BERRYIT_PUBLIC_BACKEND_URL = origin(values.BERRYIT_PUBLIC_BACKEND_URL, "Backend");
  values.BERRYIT_PUBLIC_ANON_KEY = publicKey(values.BERRYIT_PUBLIC_ANON_KEY);
  // Existing contract: Control Center is optional; never invent an API endpoint.
  if (values.BERRYIT_PUBLIC_CONTROL_URL) values.BERRYIT_PUBLIC_CONTROL_URL = origin(values.BERRYIT_PUBLIC_CONTROL_URL, "Control Center");
  return values;
}
export function packageKind(args) {
  if (!args.length || (args.length === 1 && args[0] === "--owner")) return "owner";
  if (args.length === 1 && args[0] === "--generic") return "generic";
  throw new Error("Använd package --owner eller package --generic; okända/blandade argument nekas.");
}
