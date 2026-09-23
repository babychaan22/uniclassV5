import { cn } from "@/lib/utils";

const AVATARS = [
  "/ui-kit/avatar-ava.svg",
  "/ui-kit/avatar-eli.svg",
  "/ui-kit/avatar-sophie.svg",
  "/ui-kit/avatar-noah.svg",
  "/ui-kit/avatar-lia.svg",
  "/ui-kit/avatar-omar.svg",
];

function indexFor(seed = "") {
  return [...String(seed)].reduce((total, char) => total + char.charCodeAt(0), 0) % AVATARS.length;
}

export default function UserAvatar({ name = "UniClass learner", className = "", size = "md" }) {
  const dimensions = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-14 w-14" }[size] || "h-10 w-10";
  return <img src={AVATARS[indexFor(name)]} alt="" aria-hidden="true" loading="lazy" decoding="async" className={cn("shrink-0 rounded-full border-2 border-white bg-clay-purple/10 object-cover shadow-[0_3px_8px_rgba(16,32,101,.14)]", dimensions, className)} />;
}
