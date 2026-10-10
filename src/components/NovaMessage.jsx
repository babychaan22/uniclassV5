
import { cn } from "@/lib/utils";
import { NovaAsset } from "@/components/visual/UIAsset";

const TONES = {
  violet: {
    bg: "bg-[#F0ECFF]",
    border: "border-[rgba(108,85,217,.12)]",
    text: "text-[var(--uc-navy-950)]",
  },
  blue: {
    bg: "bg-[#EAF6FE]",
    border: "border-[rgba(66,169,232,.12)]",
    text: "text-[var(--uc-navy-950)]",
  },
  green: {
    bg: "bg-[#EFF8E8]",
    border: "border-[rgba(128,201,75,.14)]",
    text: "text-[var(--uc-navy-950)]",
  },
  pink: {
    bg: "bg-[#FFF0F7]",
    border: "border-[rgba(243,74,155,.08)]",
    text: "text-[var(--uc-navy-950)]",
  },
  yellow: {
    bg: "bg-[#FFF9E6]",
    border: "border-[rgba(255,217,61,.22)]",
    text: "text-[var(--uc-navy-950)]",
  },
};

export default function NovaMessage({ variant = "welcome", tone = "violet", title, children, className = "" }) {
  const t = TONES[tone] || TONES.violet;
  return (
    <section
      className={cn(
        "nova-message relative flex min-h-28 items-center gap-3 overflow-hidden rounded-2xl border p-4 shadow-[var(--uc-shadow-sm)] sm:gap-5 sm:p-5",
        t.bg,
        t.border,
        t.text,
        className,
      )}
    >
      <NovaAsset pose={variant} className="h-20 w-20 shrink-0 sm:h-28 sm:w-28" />
      <div className="relative min-w-0 flex-1">
        <h2 className="font-display text-xl font-extrabold sm:text-2xl">{title}</h2>
        <div className="mt-1 text-sm leading-relaxed text-ink/70">{children}</div>
      </div>
    </section>
  );
}
