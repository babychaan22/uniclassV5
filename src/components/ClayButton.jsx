
import { cn } from "@/lib/utils";

const COLORS = {
  purple: "bg-clay-purple text-white",
  pink: "bg-clay-pink text-white",
  lime: "bg-clay-lime text-ink",
  sun: "bg-clay-sun text-ink",
  sky: "bg-clay-sky text-ink",
  coral: "bg-clay-coral text-white",
  cream: "bg-cream text-ink",
  white: "bg-white text-ink",
};

const SIZES = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-5 py-2.5 text-base",
  lg: "px-7 py-3.5 text-lg",
};

export default function ClayButton({ children, color = "purple", size = "md", className, ...props }) {
  return (
    <button className={cn("clay-btn", COLORS[color], SIZES[size], className)} {...props}>
      {children}
    </button>
  );
}

