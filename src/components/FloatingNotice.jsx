import { CheckCircle2, CircleAlert, X } from "lucide-react";

// Keep completion and error feedback inside the current viewport, even when an
// action was taken at the bottom of a long page.
export default function FloatingNotice({ notice, onDismiss }) {
  if (!notice) return null;
  const positive = notice.ok !== false;
  return (
    <div role={positive ? "status" : "alert"} className={`fixed bottom-20 left-4 right-4 z-[70] mx-auto flex max-w-md items-start gap-3 rounded-2xl border-2 p-3.5 shadow-[var(--uc-shadow-lg)] sm:bottom-5 sm:left-auto sm:right-5 ${positive ? "border-clay-lime/60 bg-white text-ink" : "border-clay-coral/60 bg-white text-ink"}`}>
      {positive ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-clay-lime" /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-clay-coral" />}
      <p className="min-w-0 flex-1 text-sm font-display font-bold">{notice.text || notice}</p>
      {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="rounded-lg p-1 text-ink/55 hover:bg-ink/5 hover:text-ink"><X className="h-4 w-4" /></button>}
    </div>
  );
}
