/*
 * Control Center-navigation – samma tio moduler i webben och desktopappen.
 *
 * `connected: false` betyder att modulen saknar backend-koppling. Sådana vyer
 * visar en tydlig "ej ansluten"-ruta och aldrig påhittad status eller mockdata.
 * `staffOnly` döljer modulen för kunder (databasen nekar dem ändå).
 *
 * `key` är den stabila identiteten. Webben bygger sin sökväg av den, och
 * desktopappen använder den som vy-id – ingen av klienterna behöver känna till
 * den andras routing.
 */
export type NavKey =
  | "dashboard"
  | "kunder"
  | "projekt"
  | "support"
  | "kommunikation"
  | "ai"
  | "infrastruktur"
  | "monitoring"
  | "integrationer"
  | "installningar";

export type NavItem = {
  key: NavKey;
  /** Sökväg i webbklienten. */
  href: string;
  label: string;
  icon: string;
  connected: boolean;
  /** Desktop can be connected before the corresponding web module is mounted. */
  desktopConnected?: boolean;
  staffOnly: boolean;
  description: string;
};

export const controlNav: NavItem[] = [
  {
    key: "dashboard",
    href: "/control",
    label: "Dashboard",
    icon: "system",
    connected: true,
    staffOnly: false,
    description: "Översikt över ärenden och behörigheter.",
  },
  {
    key: "kunder",
    href: "/control/kunder",
    label: "Kunder",
    icon: "business",
    connected: true,
    staffOnly: true,
    description: "Organisationer och kontaktpersoner.",
  },
  {
    key: "projekt",
    href: "/control/projekt",
    label: "Projekt",
    icon: "app",
    connected: true,
    desktopConnected: true,
    staffOnly: true,
    description: "Projektregister per kund.",
  },
  {
    key: "support",
    href: "/control/support",
    label: "Support Desk",
    icon: "troubleshoot",
    connected: true,
    staffOnly: false,
    description: "Supportärenden.",
  },
  {
    key: "kommunikation",
    href: "/control/kommunikation",
    label: "Kommunikation",
    icon: "phone",
    connected: false,
    desktopConnected: true,
    staffOnly: true,
    description: "Chattar och externa kanaler.",
  },
  {
    key: "ai",
    href: "/control/ai",
    label: "Ask ONARLY AI",
    icon: "smarthome",
    connected: false,
    desktopConnected: true,
    staffOnly: true,
    description: "Kundisolerad supportassistent via ONARLY AI Gateway.",
  },
  {
    key: "infrastruktur",
    href: "/control/infrastruktur",
    label: "Infrastruktur",
    icon: "install",
    connected: false,
    desktopConnected: true,
    staffOnly: true,
    description: "Servrar och containrar.",
  },
  {
    key: "monitoring",
    href: "/control/monitoring",
    label: "Monitoring",
    icon: "wifi",
    connected: false,
    desktopConnected: true,
    staffOnly: true,
    description: "Hälsa och larm.",
  },
  {
    key: "integrationer",
    href: "/control/integrationer",
    label: "Integrationer",
    icon: "web",
    connected: false,
    desktopConnected: true,
    staffOnly: true,
    description: "GitHub, Vercel och ONARLY DESK.",
  },
  {
    key: "installningar",
    href: "/control/installningar",
    label: "Inställningar",
    icon: "it",
    connected: true,
    staffOnly: false,
    description: "Konto, behörigheter och tema.",
  },
];

export function navFor(isStaff: boolean): NavItem[] {
  return controlNav.filter((item) => !item.staffOnly || isStaff);
}

/** Presentation from server capabilities; this never grants resource access. */
export function navForAccess(ctx: {isStaff:boolean;permissions?:string[]}):NavItem[]{
  const permissions=ctx.permissions??[];
  const visible:Partial<Record<NavKey,string[]>>={
    kunder:['tickets.read','organizations.manage'],projekt:['projects.read','projects.manage','roles.manage','roles.grant'],
    kommunikation:['tickets.read'],ai:['ai.use','tickets.read'],infrastruktur:['infrastructure.read'],
    monitoring:['infrastructure.read'],integrationer:['connectors.manage'],
  };
  return controlNav.filter(item=>!item.staffOnly||visible[item.key]?.some(p=>permissions.includes(p)));
}

export function navItem(key: NavKey): NavItem {
  const item = controlNav.find((i) => i.key === key);
  if (!item) throw new Error(`Okänd navigationsnyckel: ${key}`);
  return item;
}
