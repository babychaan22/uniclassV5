import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, CircleAlert, X } from "lucide-react";

// Keep completion and error feedback inside the current viewport, even when an
// action was taken at the bottom of a long page.
export default function FloatingNotice({ notice, onDismiss, anchorElement = null }) {
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    const lastAction = window.__uniclassPopupAnchor;
    const source = anchorElement?.isConnected
      ? anchorElement
      : lastAction instanceof HTMLElement && lastAction.isConnected
        ? lastAction
        : document.activeElement instanceof HTMLElement && document.activeElement.isConnected
          ? document.activeElement
          : null;
    if (!notice || !source) {
      setPosition(null);
      return undefined;
    }

    const placeNotice = () => {
      const rect = source.getBoundingClientRect();
      const width = Math.min(384, window.innerWidth - 32);
      const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
      const below = rect.bottom + 12;
      // Keep feedback in the active viewport. When the action is near the
      // mobile dock, show the card just above the control instead.
      const top = below + 104 < window.innerHeight ? below : Math.max(16, rect.top - 116);
      setPosition({ top, left, width });
    };

    placeNotice();
    window.addEventListener("resize", placeNotice);
    window.addEventListener("scroll", placeNotice, true);
    return () => {
      window.removeEventListener("resize", placeNotice);
      window.removeEventListener("scroll", placeNotice, true);
    };
  }, [notice, anchorElement]);

  if (!notice) return null;
  const positive = notice.ok !== false;
  const content = (
    <div role={positive ? "status" : "alert"} aria-live="polite" style={position || undefined} className={`fixed z-[100] flex max-w-md items-start gap-3 rounded-2xl border-2 p-3.5 shadow-[var(--uc-shadow-lg)] ${position ? "" : "bottom-20 left-4 right-4 mx-auto sm:bottom-5 sm:left-auto sm:right-5"} ${positive ? "border-clay-lime/60 bg-white text-ink" : "border-clay-coral/60 bg-white text-ink"}`}>
      {positive ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-clay-lime" /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-clay-coral" />}
      <p className="min-w-0 flex-1 text-sm font-display font-bold">{notice.text || notice}</p>
      {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="rounded-lg p-1 text-ink/55 hover:bg-ink/5 hover:text-ink"><X className="h-4 w-4" /></button>}
    </div>
  );
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}
