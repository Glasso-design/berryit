// A prerequisite gate, not a substitute for real Auth/PostgREST/Storage tests.
// Read-only: never starts a stack, pulls images, creates volumes or uses SSH.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function httpPreflight({ args, environment, execute = (args) => spawnSync("docker", args, { encoding: "utf8", timeout: 10000 }) }) {
  if (args.length !== 1 || args[0] !== "--environment=isolated-local-supabase") throw new Error("Requires explicit isolated-local-supabase environment");
  if (environment.NODE_ENV === "production" || environment.BERRYIT_TEST_ENV === "production") throw new Error("Production-classified environment refused");
  const external = ["DATABASE_URL", "PGHOST", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "DOCKER_HOST", "CONTAINER_HOST"];
  if (external.some(key => environment[key]?.trim())) throw new Error("Existing database, key or daemon override refused; no connection attempted");
  const context = execute(["context", "inspect"]);
  if (context.error || context.status !== 0) return { status: "BLOCKED", reason: "No usable local Docker CLI/context; real HTTP tests were not run" };
  let endpoint;
  try { endpoint = JSON.parse(context.stdout)[0]?.Endpoints?.docker?.Host; } catch { return { status: "BLOCKED", reason: "Unverifiable Docker context" }; }
  if (!(endpoint === "unix:///var/run/docker.sock" || /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint ?? ""))) throw new Error("Remote or unknown Docker endpoint refused before daemon access");
  const version = execute(["version", "--format", "{{json .Server}}"]);
  if (version.error || version.status !== 0) return { status: "BLOCKED", reason: "Local Docker daemon is unavailable" };
  try { if (JSON.parse(version.stdout).Os !== "linux") return { status: "BLOCKED", reason: "A local Linux container engine is required" }; } catch { return { status: "BLOCKED", reason: "Daemon platform could not be verified" }; }
  return { status: "PREREQUISITES_ONLY", reason: "Local runtime available; a fresh owned stack and real HTTP tests are still required. This is not PASS." };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = httpPreflight({ args: process.argv.slice(2), environment: process.env });
    console.log(JSON.stringify(result));
    process.exitCode = result.status === "BLOCKED" ? 2 : 0;
  } catch (error) { console.error("REFUSED:", error.message); process.exitCode = 1; }
}
