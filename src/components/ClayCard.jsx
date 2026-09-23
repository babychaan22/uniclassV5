
import { cn } from "@/lib/utils";

const TONES = {
  default: "bg-white text-ink",
  violet: "bg-[#F1ECFF] text-[var(--uc-navy-950)]",
  blue: "bg-[#E8F7FF] text-[var(--uc-navy-950)]",
  green: "bg-[#EDFAE0] text-[var(--uc-navy-950)]",
  pink: "bg-[#FFF0F7] text-[var(--uc-navy-950)]",
  yellow: "bg-[#FFF9E6] text-[var(--uc-navy-950)]",
  cream: "bg-cream text-ink",
  purple: "bg-clay-purple text-white",
  sky: "bg-clay-sky text-ink",
  lime: "bg-clay-lime text-ink",
  sun: "bg-clay-sun text-ink",
  coral: "bg-clay-coral text-white",
  white: "bg-white text-ink",
};

export default function ClayCard({ children, className, color = "white", tone, as: Tag = "div", ...props }) {
  const resolvedTone = tone && TONES[tone] ? tone : color;
  return (
    <Tag className={cn("clay-tile", TONES[resolvedTone] || TONES.cream, className)} {...props}>
      {children}
    </Tag>
  );
}
