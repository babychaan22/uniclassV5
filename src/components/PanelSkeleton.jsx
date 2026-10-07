import { cn } from "@/lib/utils";

// A stable layout is faster to perceive than a blank spinner. The component is
// intentionally CSS-only so it paints immediately while data arrives.
export default function PanelSkeleton({ className = "", cards = 4 }) {
  return <div aria-busy="true" aria-label="Loading panel" className={cn("mx-auto max-w-5xl space-y-5 animate-pulse", className)}>
    <div className="h-9 w-56 rounded-xl bg-clay-purple/15" />
    <div className="h-5 w-80 max-w-full rounded-lg bg-ink/10" />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: cards }, (_, index) => <div key={index} className="h-28 rounded-3xl bg-white shadow-[var(--uc-shadow-sm)]" />)}
    </div>
    <div className="h-48 rounded-3xl bg-white shadow-[var(--uc-shadow-sm)]" />
    <div className="grid gap-4 sm:grid-cols-2"><div className="h-36 rounded-3xl bg-white shadow-[var(--uc-shadow-sm)]" /><div className="h-36 rounded-3xl bg-white shadow-[var(--uc-shadow-sm)]" /></div>
    <span className="sr-only">Loading your workspace…</span>
  </div>;
}
