import { Icon } from "@/components/icons";

/**
 * Visas för moduler som saknar backend-koppling.
 * Ingen status, inga siffror och ingen mockdata hittas på – rutan säger rakt ut
 * vad som saknas och vad som krävs för att modulen ska fungera.
 */
export function NotConnected({
  title,
  description,
  requirements,
}: {
  title: string;
  description: string;
  requirements: string[];
}) {
  return (
    <section className="rounded-2xl border border-dashed border-field bg-ink-2 p-6 sm:p-10">
      <p className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-xs tracking-wide text-muted uppercase">
        <Icon name="troubleshoot" className="h-4 w-4" />
        Ej ansluten
      </p>
      <h2 className="mt-5 font-display text-2xl font-semibold">{title}</h2>
      <p className="mt-3 max-w-2xl text-muted">{description}</p>
      <p className="mt-6 font-mono text-xs tracking-wide text-muted uppercase">Krävs för att modulen ska fungera</p>
      <ul className="mt-3 space-y-2">
        {requirements.map((r) => (
          <li key={r} className="flex gap-3 text-sm text-paper/90">
            <span aria-hidden className="text-muted">
              •
            </span>
            {r}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">
        Ingen data visas här förrän kopplingen finns. Sidan hittar aldrig på status.
      </p>
    </section>
  );
}
