import logoDark from "@brand/berryit-logo-dark.png";
import logoLight from "@brand/berryit-logo-light.png";

/**
 * BERRYiT-logotypen (bärsymbol + ordmärke). Samma två godkända varianter som
 * webben använder – filerna delas, de kopieras inte. CSS visar rätt variant för
 * aktivt tema (.on-dark-only / .on-light-only i shared/tokens.css).
 */
export function Logo({ className = "h-7 w-auto" }: { className?: string }) {
  return (
    <>
      <img src={logoDark} alt="BERRYiT" className={`on-dark-only ${className}`} />
      <img src={logoLight} alt="BERRYiT" className={`on-light-only ${className}`} />
    </>
  );
}
