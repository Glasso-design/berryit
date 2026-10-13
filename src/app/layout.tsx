import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { site } from "@/content/site";
import { siteUrl, siteUrlObject } from "@/lib/seo";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Space_Grotesk({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: siteUrlObject,
  title: {
    default: `${site.name} – ${site.tagline}`,
    template: `%s – ${site.name}`,
  },
  description:
    "IT, teknik, ljud, ljus, webb, appar och kompletta digitala system. Vi fixar tekniken du har och hjälper dig bygga tekniken du behöver. Sjöbo, Skåne och digitalt.",
  openGraph: { siteName: site.name, locale: "sv_SE", type: "website" },
  twitter: { card: "summary_large_image" },
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
      logo: `${siteUrl}/brand/berryit-logo.png`,
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
      // data-theme sätts av themeInitScript före hydrering – avsiktlig skillnad mot serverns HTML.
      suppressHydrationWarning
      lang="sv"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <head>
        {/* Körs synkront vid parsning – rätt tema redan i första renderingen, ingen blinkning. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">{children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      </body>
    </html>
  );
}
