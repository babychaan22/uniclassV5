
import { cn } from "@/lib/utils";

const COLORS = {
  cream: "bg-cream text-ink",
  purple: "bg-clay-purple text-white",
  sky: "bg-clay-sky text-ink",
  lime: "bg-clay-lime text-ink",
  sun: "bg-clay-sun text-ink",
  pink: "bg-clay-pink text-white",
  coral: "bg-clay-coral text-white",
  white: "bg-white text-ink",
};

export default function ClayCard({ children, className, color = "cream", as: Tag = "div", ...props }) {
  return (
    <Tag className={cn("clay-tile", COLORS[color], className)} {...props}>
      {children}
    </Tag>
  );
}

