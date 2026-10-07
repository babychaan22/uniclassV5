import { cn } from "@/lib/utils";

export const AVATAR_OPTIONS = [
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `avatar-${index + 1}`,
    label: `Avatar ${String(index + 1).padStart(2, "0")}`,
    src: `/ui-kit/figma-avatars/avatar-${index + 1}.svg`,
  })),
];

function indexFor(seed = "") {
  return [...String(seed)].reduce((total, char) => total + char.charCodeAt(0), 0) % AVATAR_OPTIONS.length;
}

const FRAME_CLASSES = {
  "star-frame": "ring-4 ring-clay-sun ring-offset-2",
  "rainbow-frame": "ring-4 ring-clay-pink ring-offset-2 shadow-[0_0_0_3px_#60c7ff,0_0_0_6px_#baf071]",
};

export default function UserAvatar({ name = "UniClass learner", avatarKey, frameKey, className = "", size = "md" }) {
  const dimensions = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-14 w-14" }[size] || "h-10 w-10";
  const avatar = AVATAR_OPTIONS.find((option) => option.id === avatarKey) || AVATAR_OPTIONS[indexFor(name)];
  return <span className={cn("relative inline-flex shrink-0", FRAME_CLASSES[frameKey], dimensions, className)}><img src={avatar.src} alt="" aria-hidden="true" loading="lazy" decoding="async" className="h-full w-full rounded-full border-2 border-white bg-clay-purple/10 object-cover shadow-[0_3px_8px_rgba(16,32,101,.14)]" /></span>;
}
