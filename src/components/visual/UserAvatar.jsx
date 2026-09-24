import { cn } from "@/lib/utils";

export const AVATAR_OPTIONS = [
  { id: "ava", label: "Ava", src: "/ui-kit/avatar-ava.svg" },
  { id: "eli", label: "Eli", src: "/ui-kit/avatar-eli.svg" },
  { id: "sophie", label: "Sophie", src: "/ui-kit/avatar-sophie.svg" },
  { id: "noah", label: "Noah", src: "/ui-kit/avatar-noah.svg" },
  { id: "lia", label: "Lia", src: "/ui-kit/avatar-lia.svg" },
  { id: "omar", label: "Omar", src: "/ui-kit/avatar-omar.svg" },
  { id: "liam", label: "Liam", src: "/ui-kit/avatar-liam.svg" },
];

function indexFor(seed = "") {
  return [...String(seed)].reduce((total, char) => total + char.charCodeAt(0), 0) % AVATAR_OPTIONS.length;
}

export default function UserAvatar({ name = "UniClass learner", avatarKey, className = "", size = "md" }) {
  const dimensions = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-14 w-14" }[size] || "h-10 w-10";
  const avatar = AVATAR_OPTIONS.find((option) => option.id === avatarKey) || AVATAR_OPTIONS[indexFor(name)];
  return <img src={avatar.src} alt="" aria-hidden="true" loading="lazy" decoding="async" className={cn("shrink-0 rounded-full border-2 border-white bg-clay-purple/10 object-cover shadow-[0_3px_8px_rgba(16,32,101,.14)]", dimensions, className)} />;
}
