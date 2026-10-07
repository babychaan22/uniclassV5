import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";

const OPTIONS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "term", label: "Term" },
];

export default function DashboardRangeTabs({ value, onChange, anchorDate, onAnchorDateChange, className = "" }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const dateInput = useRef(null);

  function openPicker() {
    setPickerOpen(true);
    // The native calendar opens when the visible date field is selected. A
    // small popover is more reliable than forcing showPicker() across browsers.
    window.setTimeout(() => dateInput.current?.focus(), 0);
  }

  return (
    <div role="group" aria-label="Dashboard date range" className={cn("relative inline-flex rounded-2xl border border-[rgba(16,32,101,.08)] bg-white p-1 shadow-[var(--uc-shadow-sm)]", className)}>
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
      <button type="button" onClick={openPicker} className="hidden items-center rounded-xl px-2 text-ink/60 transition-colors hover:bg-clay-purple/10 hover:text-[var(--uc-purple)] sm:flex" aria-label="Choose a date" title="Choose a date">
        <CalendarDays className="h-4 w-4" />
      </button>
      {pickerOpen && <div className="absolute right-0 top-[calc(100%+.5rem)] z-20 w-60 rounded-2xl border border-ink/10 bg-white p-3 shadow-[var(--uc-shadow-lg)]">
        <div className="mb-2 flex items-center justify-between gap-2"><label htmlFor="dashboard-anchor-date" className="text-xs font-display font-bold text-ink/70">Show the period containing</label><button type="button" onClick={() => setPickerOpen(false)} className="rounded-lg p-1 text-ink/55 hover:bg-ink/5" aria-label="Close date picker"><X className="h-4 w-4" /></button></div>
        <input id="dashboard-anchor-date" ref={dateInput} type="date" value={anchorDate || ""} onChange={(event) => { onAnchorDateChange?.(event.target.value); setPickerOpen(false); }} className="clay-input w-full text-sm" />
      </div>}
    </div>
  );
}
