// Endast lokala PGlite-körningar är tillåtna. Inget verktyg här ansluter till
// en server eller erbjuder rensning av befintliga konton, ärenden eller data.
const externalDatabaseVariables = [
  "DATABASE_URL",
  "DIRECT_URL",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "PGHOST",
];

export function assertIsolatedPgliteEnvironment(args, environment) {
  if (args.length !== 1 || args[0] !== "--environment=isolated-pglite") {
    throw new Error("Kräver exakt --environment=isolated-pglite; rensning stöds inte.");
  }

  const configuredTargets = externalDatabaseVariables.filter((name) =>
    Boolean(environment[name]?.trim()),
  );
  if (configuredTargets.length > 0) {
    throw new Error(
      `Extern databaskonfiguration finns (${configuredTargets.join(", ")}); avbryter lokal testkörning.`,
    );
  }
}
