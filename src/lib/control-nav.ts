/*
 * Control Center-navigationen bor i det delade paketet så att webben och
 * desktopappen aldrig kan visa olika moduler. Re-exporten finns kvar för att
 * webbens importsökvägar ska vara oförändrade.
 */
export { controlNav, navFor, navItem } from "@berryit/shared/nav";
export type { NavItem, NavKey } from "@berryit/shared/nav";
