/** Ordmärke: BERRY i versaler, ett litet "i" som bär-punkt, T. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-display text-xl font-bold tracking-tight ${className}`}>
      BERRY
      <span className="relative mx-[1px] text-berry">
        i
      </span>
      T
    </span>
  );
}
