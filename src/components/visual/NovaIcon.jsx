import { useId } from "react";
import { cn } from "@/lib/utils";

// UniClass's native SVG icon family follows the bloom emblem: clear ink,
// primary lavender, secondary sky, and learning-progress green.
const PALETTE = { navy: "#26334A", sky: "#42A9E8", lavender: "#6C55D9", green: "#80C94B", white: "#FFFFFF" };

function Stroke({ children }) {
  return <g fill="none" stroke={PALETTE.navy} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">{children}</g>;
}

function Glyph({ name }) {
  const common = { fill: PALETTE.lavender, stroke: PALETTE.navy, strokeWidth: "2.1", strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "home": return <><path {...common} d="M5 11.5 12 5l7 6.5v7.8H5z" /><path d="M10 19.3v-4.7h4v4.7" fill={PALETTE.sky} stroke={PALETTE.navy} strokeWidth="2" /></>;
    case "classes": return <><path {...common} d="M5 6.5c2.4-1.2 4.6-.9 7 1v11c-2.4-1.9-4.6-2.2-7-1zM19 6.5c-2.4-1.2-4.6-.9-7 1v11c2.4-1.9 4.6-2.2 7-1z" /><path d="M7.3 10h2.4M14.3 10h2.4" stroke={PALETTE.sky} strokeWidth="1.8" strokeLinecap="round" /></>;
    case "students": return <><circle cx="9" cy="9" r="3" fill={PALETTE.sky} stroke={PALETTE.navy} strokeWidth="2" /><circle cx="16.5" cy="10" r="2.5" fill={PALETTE.lavender} stroke={PALETTE.navy} strokeWidth="2" /><path {...common} d="M3.8 19c.7-3.2 2.5-4.7 5.2-4.7s4.5 1.5 5.2 4.7zM14 18.8c.4-2.3 1.8-3.5 4.1-3.5 1.2 0 2.1.3 2.8 1" /></>;
    case "assessment": return <><rect {...common} x="6" y="5" width="12" height="15" rx="2" /><path d="M9 5.3h6v2.5H9z" fill={PALETTE.green} stroke={PALETTE.navy} strokeWidth="1.8" /><path d="m9 13 1.5 1.5 3-3M9 17h5" stroke={PALETTE.white} strokeWidth="2" strokeLinecap="round" /></>;
    case "attendance": return <><rect {...common} x="4.5" y="6" width="15" height="13" rx="2.3" /><path d="M4.8 10h14.4M8 4.8v3M16 4.8v3" stroke={PALETTE.navy} strokeWidth="2.2" strokeLinecap="round" /><path d="m8.5 14 2 2 4.5-4.5" stroke={PALETTE.sky} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></>;
    case "resources": return <><path {...common} d="M7 4.5h7l4 4V19.5H7z" /><path d="M14 4.5v4h4M9.5 13h5M9.5 16h4" stroke={PALETTE.sky} strokeWidth="2" strokeLinecap="round" /></>;
    case "ai": return <><path {...common} d="M8 15.5c-1.3-1-2-2.5-2-4.2a6 6 0 0 1 12 0c0 1.7-.7 3.2-2 4.2-.7.6-1.1 1.3-1.1 2.2H9.1c0-.9-.4-1.6-1.1-2.2Z" /><path d="M9.5 20h5M10.2 17.7h3.6" stroke={PALETTE.navy} strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="11.3" r="1.5" fill={PALETTE.green} /></>;
    case "analytics": return <><path {...common} d="M5 19V5M5 19h15" /><rect x="8" y="13" width="2.8" height="4" rx="1" fill={PALETTE.sky} /><rect x="12" y="9" width="2.8" height="8" rx="1" fill={PALETTE.lavender} /><rect x="16" y="6" width="2.8" height="11" rx="1" fill={PALETTE.green} /></>;
    case "settings": return <><path {...common} d="M12 4.5 13.6 6l2-.2.8 1.8 1.8.9-.2 2 1.2 1.5-1.2 1.5.2 2-1.8.9-.8 1.8-2-.2L12 19.5 10.4 18l-2 .2-.8-1.8-1.8-.9.2-2L4.8 12 6 10.5l-.2-2 1.8-.9.8-1.8 2 .2z" /><circle cx="12" cy="12" r="2.6" fill={PALETTE.sky} stroke={PALETTE.navy} strokeWidth="2" /></>;
    case "notifications": return <><path {...common} d="M6.5 16.5h11l-1.3-2.1v-3.1a4.2 4.2 0 0 0-8.4 0v3.1z" /><path d="M10 19c.4.8 1 1.2 2 1.2s1.6-.4 2-1.2" stroke={PALETTE.navy} strokeWidth="2" strokeLinecap="round" /><circle cx="17.7" cy="6.6" r="2" fill={PALETTE.green} stroke={PALETTE.navy} strokeWidth="1.5" /></>;
    case "search": return <><circle {...common} cx="10.5" cy="10.5" r="5" /><path d="m14.3 14.3 4.2 4.2" stroke={PALETTE.navy} strokeWidth="2.5" strokeLinecap="round" /><circle cx="10.5" cy="10.5" r="2" fill={PALETTE.sky} /></>;
    case "filter": return <><path {...common} d="M5 7h14M5 12h14M5 17h14" /><circle cx="10" cy="7" r="2" fill={PALETTE.sky} stroke={PALETTE.navy} strokeWidth="1.6" /><circle cx="15" cy="12" r="2" fill={PALETTE.lavender} stroke={PALETTE.navy} strokeWidth="1.6" /><circle cx="8" cy="17" r="2" fill={PALETTE.green} stroke={PALETTE.navy} strokeWidth="1.6" /></>;
    case "profile": return <><rect {...common} x="4.5" y="5" width="15" height="14" rx="3" /><circle cx="12" cy="10" r="2.5" fill={PALETTE.sky} stroke={PALETTE.navy} strokeWidth="1.8" /><path d="M8.2 16c.6-2.2 1.9-3.2 3.8-3.2s3.2 1 3.8 3.2" fill={PALETTE.green} stroke={PALETTE.navy} strokeWidth="1.8" strokeLinecap="round" /></>;
    case "help": return <><circle {...common} cx="12" cy="12" r="8" /><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.8-2.1 2-2.1 3.6M12 17.3h.01" stroke={PALETTE.white} strokeWidth="2" strokeLinecap="round" /></>;
    case "upload": return <><path {...common} d="M7 18.5h10a3 3 0 0 0 .2-6 5.3 5.3 0 0 0-10.3.8A2.7 2.7 0 0 0 7 18.5Z" /><path d="M12 16V9m0 0-2.5 2.5M12 9l2.5 2.5" stroke={PALETTE.white} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></>;
    case "download": return <><path {...common} d="M6 16.5v2h12v-2" /><path d="M12 5v9m0 0-3-3m3 3 3-3" stroke={PALETTE.sky} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" /></>;
    case "edit": return <><path {...common} d="m6 17.8 1-4.1L15.6 5a2 2 0 0 1 2.8 2.8L9.7 16.5z" /><path d="m14.3 6.3 2.8 2.8" stroke={PALETTE.white} strokeWidth="1.8" /></>;
    case "delete": return <><path {...common} d="M7.5 8.5h9l-.8 11h-7.4zM9.5 6h5M5.8 8.5h12.4" /><path d="M10 11.5v4.5M14 11.5v4.5" stroke={PALETTE.sky} strokeWidth="1.8" strokeLinecap="round" /></>;
    case "reward": return <><path {...common} d="M8 5.5h8v4.7c0 3-1.7 5-4 5s-4-2-4-5z" /><path d="M8 7H5.5c0 3 1.1 4.6 3.1 4.7M16 7h2.5c0 3-1.1 4.6-3.1 4.7M12 15.2v3.1M9 20h6" stroke={PALETTE.navy} strokeWidth="2" strokeLinecap="round" /><path d="m12 8 .8 1.7 1.8.2-1.3 1.2.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.2 1.8-.2z" fill={PALETTE.green} /></>;
    case "badge": return <><path {...common} d="m5 7 3 4 4-6 4 6 3-4v10.5H5z" /><circle cx="12" cy="15" r="2.6" fill={PALETTE.green} stroke={PALETTE.navy} strokeWidth="1.6" /></>;
    case "view": return <><path {...common} d="M4.5 12s2.6-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.6 4.5-7.5 4.5S4.5 12 4.5 12Z" /><circle cx="12" cy="12" r="2.4" fill={PALETTE.sky} stroke={PALETTE.navy} strokeWidth="1.6" /></>;
    case "menu": return <><rect {...common} x="5" y="5.5" width="14" height="13" rx="3" /><path d="M8.5 9.5h7M8.5 12h7M8.5 14.5h4" stroke={PALETTE.white} strokeWidth="1.9" strokeLinecap="round" /></>;
    case "missions": return <><circle {...common} cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3.5" fill={PALETTE.sky} stroke={PALETTE.navy} strokeWidth="1.8" /><path d="m12 12 5-5" stroke={PALETTE.green} strokeWidth="2.2" strokeLinecap="round" /></>;
    case "qr": return <><rect {...common} x="5" y="5" width="14" height="14" rx="2" /><path d="M7.5 7.5h3v3h-3zM13.5 7.5h3v3h-3z" fill={PALETTE.white} stroke={PALETTE.navy} strokeWidth="1.3" /><path d="M7.5 13.5h3v3h-3z" fill={PALETTE.green} stroke={PALETTE.navy} strokeWidth="1.3" /><path d="M13.5 13.5h1.6v1.6h1.5v1.5h-3.1z" fill={PALETTE.sky} /></>;
    case "scoreImport": return <><path {...common} d="M7 8h9l-2-2M17 16H8l2 2" /><path d="m14 6 2 2-2 2M10 14l-2 2 2 2" stroke={PALETTE.sky} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></>;
    case "activities": return <><circle {...common} cx="12" cy="12" r="7.5" /><path d="m8.5 12 2.3 2.3 4.8-4.8" stroke={PALETTE.white} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" /></>;
    case "history": return <><circle {...common} cx="12" cy="12" r="7.5" /><path d="M12 8v4.3l3 1.8" stroke={PALETTE.white} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" /></>;
    case "leaderboard": return <><path {...common} d="m12 5 2 4 4.4.6-3.2 3.1.8 4.4-4-2.1-4 2.1.8-4.4-3.2-3.1L10 9z" /><circle cx="12" cy="11.5" r="1.6" fill={PALETTE.green} /></>;
    case "archive": return <><path {...common} d="M5 8h14v11H5z" /><path d="M4 6h16v3H4z" fill={PALETTE.sky} stroke={PALETTE.navy} strokeWidth="2" strokeLinejoin="round" /><path d="M10 13h4" stroke={PALETTE.white} strokeWidth="2" strokeLinecap="round" /></>;
    default: return <Stroke><circle cx="12" cy="12" r="7" /><path d="M12 8v4l2.5 2" /></Stroke>;
  }
}

export default function NovaIcon({ name, title, className = "", ...props }) {
  const rawId = useId().replace(/:/g, "");
  const gradientId = `nova-${rawId}`;
  return <svg {...props} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} className={cn("nova-icon", className)} style={{ filter: "drop-shadow(0 2px 2px rgba(38,51,74,.16))" }}>
    {title && <title>{title}</title>}
    <defs><linearGradient id={gradientId} x1="4" y1="4" x2="20" y2="20"><stop stopColor="#ffffff" /><stop offset="1" stopColor="#F0ECFF" /></linearGradient></defs>
    <circle cx="12" cy="12" r="10.2" fill={`url(#${gradientId})`} opacity=".32" />
    <Glyph name={name} />
  </svg>;
}
