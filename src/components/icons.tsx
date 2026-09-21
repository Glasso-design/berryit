const paths: Record<string, React.ReactNode> = {
  it: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  av: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  app: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  system: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 17.5h7M17.5 14v7" />
    </>
  ),
  fixa: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z" />,
  installera: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  forbattra: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  bygga: (
    <>
      <path d="M8 6 2 12l6 6M16 6l6 6-6 6" />
      <path d="m14 4-4 16" />
    </>
  ),
  // Hemma-ikoner – samma linjestil som ovan.
  laptop: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </>
  ),
  wifi: (
    <>
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" />
      <circle cx="12" cy="19.2" r="0.9" fill="currentColor" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3.5h10V8" />
      <rect x="3" y="8" width="18" height="8.5" rx="2" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  gaming: (
    <>
      <path d="M7.5 7h9a4.5 4.5 0 0 1 4.3 5.8l-1.1 3.6a2.3 2.3 0 0 1-4 .7L14 15.2h-4l-1.7 1.9a2.3 2.3 0 0 1-4-.7l-1.1-3.6A4.5 4.5 0 0 1 7.5 7Z" />
      <path d="M8 10v3M6.5 11.5h3" />
      <circle cx="15.5" cy="10.5" r="0.6" fill="currentColor" />
      <circle cx="17" cy="12.5" r="0.6" fill="currentColor" />
    </>
  ),
  tv: (
    <>
      <rect x="2.5" y="5" width="19" height="12" rx="1.5" />
      <path d="M8 20.5h8M12 17v3.5" />
      <path d="m10.5 9 3.5 2-3.5 2z" fill="currentColor" />
    </>
  ),
  speaker: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <circle cx="12" cy="14.5" r="3.5" />
      <circle cx="12" cy="7" r="1" fill="currentColor" />
    </>
  ),
  phone: (
    <>
      <rect x="4" y="3" width="10" height="17" rx="2" />
      <rect x="15" y="8" width="6" height="11" rx="1.5" />
      <path d="M8 16.5h2" />
    </>
  ),
  smarthome: (
    <>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M9.5 14.5a3.5 3.5 0 0 1 5 0M11 16.5a1.4 1.4 0 0 1 2 0" />
    </>
  ),
  install: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),
  troubleshoot: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5.5 5.5M10.5 7.5v3.5M10.5 13.5v.01" />
    </>
  ),
  energy: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  receipt: (
    <>
      <path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  business: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8.5 7V4.5h7V7M3 12.5h18" />
    </>
  ),
};

export function Icon({ name, className = "h-6 w-6" }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}
