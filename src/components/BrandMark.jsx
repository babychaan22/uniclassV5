import { cn } from "@/lib/utils";

// The bloom emblem is the shared visual anchor for the purple, blue, and green
// brand system used by the app and Nova iconography.
export default function BrandMark({ className = "", compact = false }) {
  return (
    <img
      src="/brand/uniclass-bloom.png"
      alt=""
      aria-hidden="true"
      className={cn("uc-brand-mark", compact && "uc-brand-mark--compact", className)}
    />
  );
}
