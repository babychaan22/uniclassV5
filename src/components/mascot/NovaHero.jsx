
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
    <section className={cn("nova-hero grid items-center gap-3 xl:grid-cols-[1.18fr_.82fr] xl:gap-5", className)}>
      <div className="min-w-0 px-1 py-1 sm:py-2">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-clay-sun/20 px-3 py-1 text-xs font-display font-bold text-[var(--uc-navy-950)]">
          <span className="h-1.5 w-1.5 rounded-full bg-clay-purple" /> Classroom progress
        </p>
        {title && <h2 className="uc-page-title text-3xl leading-[.94] sm:text-4xl lg:text-5xl">{title}</h2>}
        {subtitle && <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink/65">{subtitle}</p>}
      </div>
      <div className="relative flex min-h-28 items-center overflow-hidden rounded-[22px] border border-[rgba(142,92,246,.08)] bg-[linear-gradient(135deg,#F3EFFF_0%,#EAE5FF_100%)] p-3 shadow-[var(--uc-shadow-sm)] sm:min-h-32 sm:p-4">
        <NovaAsset pose={variant} priority={priority} className="absolute z-10 -bottom-2 -left-2 h-24 w-24 sm:bottom-0 sm:left-0 sm:h-28 sm:w-28" />
        <div className="relative ml-[5.4rem] min-w-0 sm:ml-24">
          <h3 className="font-display text-xl font-extrabold leading-none text-[var(--uc-navy-950)] sm:text-2xl">{greeting}</h3>
          {greetingSubtext && <p className="mt-1.5 text-sm leading-snug text-ink/70">{greetingSubtext}</p>}
        </div>
      </div>
    </section>
  );
}
