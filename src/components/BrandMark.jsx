import { cn } from "@/lib/utils";

// A lightweight, CSS-made mark keeps the header crisp without another large image asset.
export default function BrandMark({ className = "", compact = false }) {
  return (
    <span aria-hidden="true" className={cn("uc-brand-mark", compact && "uc-brand-mark--compact", className)}>
      <i className="uc-brand-mark__leaf uc-brand-mark__leaf--purple" />
      <i className="uc-brand-mark__leaf uc-brand-mark__leaf--blue" />
      <i className="uc-brand-mark__leaf uc-brand-mark__leaf--green" />
      <i className="uc-brand-mark__stem" />
    </span>
  );
}
