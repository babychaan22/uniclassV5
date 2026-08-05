
import { cn } from "@/lib/utils";

const COLORS = {
  lime: "bg-clay-lime text-ink",
  sun: "bg-clay-sun text-ink",
  coral: "bg-clay-coral text-white",
  sky: "bg-clay-sky text-ink",
  pink: "bg-clay-pink text-white",
  purple: "bg-clay-purple text-white",
  cream: "bg-cream text-ink",
  white: "bg-white text-ink",
};

export default function ClayChip({ children, color = "sun", className, ...props }) {
  return (
    <span className={cn("clay-chip px-3 py-1 text-sm", COLORS[color], className)} {...props}>
      {children}
    </span>
  );
}

