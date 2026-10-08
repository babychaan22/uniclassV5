
import { cn } from "@/lib/utils";
import { NovaAsset } from "@/components/visual/UIAsset";

export default function NovaHero({
  variant = "welcome",
  title,
  subtitle,
  greeting = "Hi, Teacher!",
  greetingSubtext,
  className = "",
  priority = true,
}) {
  return (
    <section className={cn("nova-hero grid items-center gap-4 xl:grid-cols-[1.08fr_.92fr] xl:gap-7", className)}>
      <div className="min-w-0 px-1 py-2 sm:py-4">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-clay-sun/20 px-3 py-1 text-xs font-display font-bold text-[var(--uc-navy-950)]">
          <span className="h-1.5 w-1.5 rounded-full bg-clay-purple" /> Classroom progress
        </p>
        {title && <h2 className="uc-page-title text-4xl leading-[.9] sm:text-5xl lg:text-6xl">{title}</h2>}
        {subtitle && <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink/65 sm:text-base">{subtitle}</p>}
      </div>
      <div className="relative flex min-h-40 items-center overflow-hidden rounded-[26px] border border-[rgba(142,92,246,.08)] bg-[linear-gradient(135deg,#F3EFFF_0%,#EAE5FF_100%)] p-4 shadow-[var(--uc-shadow-sm)] sm:min-h-44 sm:p-5">
        <NovaAsset pose={variant} priority={priority} className="absolute z-10 -bottom-3 -left-3 h-28 w-28 sm:bottom-0 sm:left-0 sm:h-36 sm:w-36" />
        <div className="relative ml-[6.25rem] min-w-0 sm:ml-32">
          <h3 className="font-display text-2xl font-extrabold leading-none text-[var(--uc-navy-950)] sm:text-3xl">{greeting}</h3>
          {greetingSubtext && <p className="mt-2 text-sm leading-relaxed text-ink/70 sm:text-base">{greetingSubtext}</p>}
        </div>
      </div>
    </section>
  );
}
