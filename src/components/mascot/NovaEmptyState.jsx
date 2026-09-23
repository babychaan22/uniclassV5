
import { cn } from "@/lib/utils";
import { NovaAsset } from "@/components/visual/UIAsset";
import { Link } from "react-router-dom";

export default function NovaEmptyState({
  variant = "idea",
  title = "Nothing here yet",
  description = "You're all caught up.",
  actionLabel = "Get started",
  actionHref,
  actionOnClick,
  className = "",
  children,
}) {
  return (
    <div
      className={cn(
        "nova-empty-state flex flex-col items-center justify-center gap-4 rounded-[28px] border border-[rgba(16,32,101,.06)] bg-[rgba(255,255,255,.97)] px-6 py-10 text-center shadow-[var(--uc-shadow-sm)]",
        className,
      )}
    >
      <div className="relative flex h-24 w-24 shrink-0 items-end justify-center overflow-visible sm:h-32 sm:w-32">
        <NovaAsset pose={variant} className="h-full w-full" />
      </div>
      <div className="max-w-xs">
        {title && <h3 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">{title}</h3>}
        {description && <p className="mt-1.5 text-sm leading-relaxed text-ink/60">{description}</p>}
        {children && <div className="mt-2">{children}</div>}
        {actionLabel && (
          <Link
            to={actionHref || "#"}
            onClick={actionOnClick}
            className={cn(
              "clay-btn mt-3 inline-flex items-center justify-center gap-2 bg-clay-purple px-5 py-2.5 text-sm font-display font-extrabold text-white",
              !actionHref && "pointer-events-none opacity-50",
            )}
          >
            {actionLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
