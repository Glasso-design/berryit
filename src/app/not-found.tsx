import type { Metadata } from "next";
import { ButtonLink, Container, Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sidan hittades inte",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <section className="pt-40 pb-32">
      <Container>
        <Eyebrow>404</Eyebrow>
        <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight sm:text-6xl">Den här sidan fungerar inte.</h1>
        <p className="mt-6 max-w-xl text-lg text-muted">Men det mesta annat gör det. Sidan du letar efter finns inte.</p>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/">Till startsidan</ButtonLink>
          <ButtonLink href="/kontakt" variant="ghost">Få hjälp</ButtonLink>
        </div>
      </Container>
    </section>
  );
}
