import { useEffect, useState } from "react";
import { Icon } from "@berryit/shared/ui/Icon";
import { applyTheme, resolveTheme, storeTheme, type Theme } from "@berryit/shared/theme";

/** Samma tema och samma lagringsnyckel som webben. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    storeTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Byt till ljust tema" : "Byt till mörkt tema"}
      title={theme === "dark" ? "Ljust tema" : "Mörkt tema"}
      className="rounded-full border border-line p-2 text-muted transition hover:text-paper"
    >
      <Icon name={theme === "dark" ? "energy" : "system"} className="h-4 w-4" />
    </button>
  );
}
