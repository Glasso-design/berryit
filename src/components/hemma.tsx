import Link from "next/link";
import Image from "next/image";
import hemmaLockupDark from "@/assets/brand/berryit-hemma-lockup-dark.png";
import hemmaLockupLight from "@/assets/brand/berryit-hemma-lockup-light.png";
import { rut, sunvolt, type HomeService } from "@/content/home";
import { Icon } from "./icons";

/**
 * BERRYiT HEMMA – sekundär lockup: masterlogotypen oförändrad + "HEMMA" i
 * Space Grotesk på samma baslinje, med en tunn takvinkel i logoröd som enda
 * hemsignal. Genererad från originalet – se brand/berryit-hemma-lockup.generator.html.
 */
export function HemmaLockup({ size = "md", className = "" }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const h = { sm: "h-8", md: "h-11", lg: "h-14 sm:h-20" }[size];
  const common = { sizes: "(min-width: 640px) 420px, 300px" } as const;
  return (
    <>
      <Image src={hemmaLockupDark} alt="BERRYiT HEMMA" {...common} className={`on-dark-only ${h} w-auto ${className}`} />
      <Image src={hemmaLockupLight} alt="BERRYiT HEMMA" {...common} className={`on-light-only ${h} w-auto ${className}`} />
    </>
  );
}

/**
 * "Upp till 50 % RUT på arbetskostnaden" – alltid med villkoren direkt under,
 * så att siffran aldrig står utan förbehåll.
 */
export function RutHighlight({ className = "", link = true }: { className?: string; link?: boolean }) {
  return (
    <div className={`rounded-2xl border border-signal/30 bg-signal/[0.06] px-5 py-4 ${className}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-display text-2xl font-bold tracking-tight text-signal sm:text-3xl">{rut.headline.amount}</span>
        <span className="font-display text-lg font-semibold text-paper">{rut.headline.rest}</span>
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{rut.conditions}</p>
      {link && (
        <Link href="/rut-avdrag" className="mt-2 inline-flex text-sm font-semibold text-signal hover:underline">
          Så fungerar RUT-avdrag <span aria-hidden className="ml-1">→</span>
        </Link>
      )}
    </div>
  );
}

export function RutCallout({ compact = false }: { compact?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-signal/30 bg-gradient-to-br from-signal/10 via-ink-2 to-ink-2 p-6 sm:p-10">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-signal">
            <Icon name="receipt" className="h-4 w-4" /> RUT-avdrag
          </p>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-4xl font-bold tracking-tight text-signal sm:text-5xl">{rut.headline.amount}</span>
            <span className="font-display text-xl font-semibold sm:text-2xl">{rut.headline.rest}</span>
          </p>
          <p className={`mt-4 text-paper/90 text-pretty ${compact ? "text-base" : "text-lg"}`}>{rut.statement}</p>
          <p className="mt-3 text-sm text-muted">{rut.conditions}</p>
        </div>
        <Link
          href="/rut-avdrag"
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-full border border-signal/50 px-5 py-2.5 text-sm font-semibold text-signal transition hover:bg-signal/10 md:self-center"
        >
          Läs om RUT-avdrag <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}

export function HomeServiceGrid({ services, detailed = false }: { services: HomeService[]; detailed?: boolean }) {
  return (
    <ul className={`grid gap-4 sm:grid-cols-2 ${detailed ? "lg:grid-cols-3" : "lg:grid-cols-5"}`}>
      {services.map((s) => (
        <li key={s.key} id={detailed ? s.key : undefined} className="flex flex-col rounded-2xl border border-line bg-ink-2 p-5 sm:p-6">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-berry/15 text-berry-2">
            <Icon name={s.icon} />
          </span>
          <h3 className="mt-5 font-display text-lg font-semibold">{s.title}</h3>
          <p className="mt-1.5 text-sm text-muted">{s.text}</p>
          {detailed && (
            <ul className="mt-4 space-y-1.5 text-sm text-paper/85">
              {s.items.map((i) => (
                <li key={i} className="flex gap-2">
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                  {i}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * "I samarbete med Sunvolt" (godkänd formulering). Ingen godkänd Sunvolt-logotyp
 * finns – namnet visas som text i en egen partneryta, aldrig i BERRYiT-logon.
 */
export function SunvoltPartner() {
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-ink-2">
      <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">{sunvolt.partnerLine}</p>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{sunvolt.heading}</h2>
          <p className="mt-4 text-lg text-muted">{sunvolt.lead}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-ink p-5">
            <p className="flex items-center gap-2 font-display font-semibold">
              <Icon name="smarthome" className="h-5 w-5 text-berry-2" /> BERRYiT
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted">
              {sunvolt.berryit.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-ink p-5">
            <p className="flex items-center gap-2 font-display font-semibold">
              <Icon name="energy" className="h-5 w-5 text-signal" /> Sunvolt
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted">
              {sunvolt.sunvoltScope.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-muted sm:col-span-2">
            Vill du veta mer om solenergi? Välj{" "}
            <Link href="/kontakt?kund=hem&area=energi" className="font-semibold text-paper underline-offset-4 hover:underline">
              Energi / sol
            </Link>{" "}
            i förfrågan så återkommer vi.
          </p>
        </div>
      </div>
    </div>
  );
}
