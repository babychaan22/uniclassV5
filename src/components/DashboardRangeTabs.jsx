import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "term", label: "Term" },
];

export default function DashboardRangeTabs({ value, onChange, className = "" }) {
  return (
    <div role="group" aria-label="Dashboard date range" className={cn("inline-flex rounded-2xl border border-[rgba(16,32,101,.08)] bg-white p-1 shadow-[var(--uc-shadow-sm)]", className)}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-9 rounded-xl px-3 text-xs font-display font-bold transition-colors sm:px-4 sm:text-sm",
            value === option.value ? "bg-clay-purple text-white shadow-[0_3px_8px_rgba(142,92,246,.24)]" : "text-ink/65 hover:bg-clay-purple/10 hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
      <span aria-hidden="true" className="hidden items-center px-2 text-ink/60 sm:flex"><CalendarDays className="h-4 w-4" /></span>
    </div>
  );
}
