import Image from "next/image";
import logoDark from "@/assets/brand/berryit-logo-dark.png";

/**
 * BERRYiT-logotypen (bärsymbol + ordmärke) i mörk-bakgrundsvariant:
 * originalets röda delar, mörka delar i ljus ton. Källfiler i /brand.
 */
export function Logo({ className = "h-9 w-auto", priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src={logoDark}
      alt="BERRYiT"
      priority={priority}
      sizes="(min-width: 640px) 320px, 240px"
      className={className}
    />
  );
}
