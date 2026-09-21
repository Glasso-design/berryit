import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { site } from "@/content/site";
import { siteUrl } from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Space_Grotesk({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${site.name} – ${site.tagline}`,
    template: `%s – ${site.name}`,
  },
  description:
    "IT, teknik, ljud, ljus, webb, appar och kompletta digitala system. Vi fixar tekniken du har och hjälper dig bygga tekniken du behöver. Sjöbo, Skåne och digitalt.",
  openGraph: { siteName: site.name, locale: "sv_SE", type: "website" },
  twitter: { card: "summary" },
};

/*
 * Strukturerad data – endast verifierade uppgifter. Adress, telefon,
 * öppettider och betyg läggs INTE till förrän ägaren bekräftat dem.
 */
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: site.name,
      url: siteUrl,
      slogan: site.tagline,
      description: site.oneLiner,
      areaServed: ["Sjöbo", "Skåne", "Sverige"],
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: site.name,
      url: siteUrl,
      inLanguage: "sv-SE",
      publisher: { "@id": `${siteUrl}/#organization` },
    },
  ],
};

export const viewport: Viewport = { themeColor: "#0c0b10" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="sv"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#innehall"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-berry focus:px-4 focus:py-2 focus:text-white"
        >
          Hoppa till innehållet
        </a>
        <Header />
        <main id="innehall" className="flex-1">
          {children}
        </main>
        <Footer />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      </body>
    </html>
  );
}
