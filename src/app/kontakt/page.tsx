import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { ContactForm } from "@/components/ContactForm";
import { site } from "@/content/site";
import { Container, Eyebrow } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "Kontakt",
  description:
    "Berätta vad du behöver hjälp med – teknikhjälp hemma eller IT, AV, webb, appar och system för företag. Flera saker i samma förfrågan.",
  path: "/kontakt",
});

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page(props: PageProps<"/kontakt">) {
  const sp = await props.searchParams;
  return (
    <section className="relative pt-32 pb-24 sm:pt-40">
      <div aria-hidden className="bg-grid absolute inset-x-0 top-0 h-[500px]" />
      <Container className="relative">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.6fr]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow>Kontakt</Eyebrow>
            <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Vad behöver du hjälp med?
            </h1>
            <p className="mt-6 text-lg text-muted">
              Berätta vad du försöker göra. Vi hjälper dig hitta tekniken som behövs – oavsett om något har gått sönder
              eller om du vill bygga något helt nytt.
            </p>
            <p className="mt-4 text-lg text-paper/90">
              Hemma eller i verksamheten – samla allt som behöver fixas i samma förfrågan.
            </p>
            <p className="mt-6 text-sm text-muted">{site.area}</p>
            {(site.contact.email || site.contact.phone) && (
              <ul className="mt-8 space-y-2">
                {site.contact.email && (
                  <li>
                    <a href={`mailto:${site.contact.email}`} className="text-lg hover:text-berry-2">
                      {site.contact.email}
                    </a>
                  </li>
                )}
                {site.contact.phone && (
                  <li>
                    <a href={`tel:${site.contact.phone.replace(/[^+\d]/g, "")}`} className="text-lg hover:text-berry-2">
                      {site.contact.phone}
                    </a>
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="rounded-3xl border border-line bg-ink-2 p-6 sm:p-10">
            <ContactForm
              key={`${one(sp.kund) ?? ""}-${one(sp.area) ?? ""}-${one(sp.intent) ?? ""}`}
              initialCustomer={one(sp.kund)}
              initialArea={one(sp.area)}
              initialIntent={one(sp.intent)}
            />
          </div>
        </div>
      </Container>
    </section>
  );
}
