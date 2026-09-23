import { CLASS_DAY_OPTIONS, normalizeClassDays } from "@/lib/classDays";

export default function ClassDaySelector({ value, onChange, compact = false }) {
  const selected = normalizeClassDays(value);

  function toggle(day) {
    const next = selected.includes(day)
      ? selected.filter((item) => item !== day)
      : [...selected, day].sort();
    if (next.length) onChange(next);
  }

  return (
    <fieldset className={compact ? "" : "rounded-xl border-2 border-ink/15 bg-cream p-3"}>
      <legend className="font-display font-bold text-xs px-1">Class meeting days</legend>
      <p className="mb-2 text-xs text-ink/60">Select every day this class normally meets. Streaks skip days without class.</p>
      <div className="grid grid-cols-7 gap-1.5" aria-label="Class meeting days">
        {CLASS_DAY_OPTIONS.map((day) => {
          const active = selected.includes(day.value);
          return (
            <button
              key={day.value}
              type="button"
              aria-pressed={active}
              aria-label={day.fullLabel}
              onClick={() => toggle(day.value)}
              className={`min-h-10 rounded-lg border-2 px-1 text-xs font-display font-bold transition ${active ? "border-clay-purple bg-clay-purple text-white" : "border-ink/15 bg-white text-ink/60"}`}
            >
              {day.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
