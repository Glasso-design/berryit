import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

/**
 * Publika webbplatsen: header, footer och hoppa-till-innehållet.
 * Control Center ligger utanför den här gruppen och har ett eget skal.
 */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
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
    </>
  );
}
