import Image from "next/image";
import logoDark from "@/assets/brand/berryit-logo-dark.png";
import logoLight from "@/assets/brand/berryit-logo-light.png";

/**
 * BERRYiT-logotypen (bärsymbol + ordmärke). Båda godkända varianterna renderas
 * och CSS visar rätt en för aktivt tema (.on-dark-only / .on-light-only i
 * globals.css) – ingen hydreringsskillnad och ingen blinkning. Källfiler i /brand.
 */
export function Logo({ className = "h-9 w-auto", priority = false }: { className?: string; priority?: boolean }) {
  const common = { priority, sizes: "(min-width: 640px) 320px, 240px" } as const;
  return (
    <>
      <Image src={logoDark} alt="BERRYiT" {...common} className={`on-dark-only ${className}`} />
      <Image src={logoLight} alt="BERRYiT" {...common} className={`on-light-only ${className}`} />
    </>
  );
}
