import { useLayoutEffect, useState } from "react";
import ClayButton from "@/components/ClayButton";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function ClayConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", confirmColor = "coral", busy = false, onConfirm, anchorElement = null }) {
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
    if (!open || !source) {
      setPosition(null);
      return undefined;
    }
    const placeDialog = () => {
      const rect = source.getBoundingClientRect();
      const width = Math.min(512, window.innerWidth - 32);
      const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
      const below = rect.bottom + 12;
      const top = below + 280 < window.innerHeight ? below : Math.max(16, rect.top - 292);
      setPosition({ top, left, width });
    };
    placeDialog();
    window.addEventListener("resize", placeDialog);
    window.addEventListener("scroll", placeDialog, true);
    return () => {
      window.removeEventListener("resize", placeDialog);
      window.removeEventListener("scroll", placeDialog, true);
    };
  }, [open, anchorElement]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent style={position || undefined} className={`w-[calc(100%-2rem)] rounded-3xl border-2 border-ink/10 bg-white p-5 shadow-[var(--uc-shadow-lg)] sm:p-6 ${position ? "!translate-x-0 !translate-y-0" : ""}`}>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">{title}</AlertDialogTitle>
          <AlertDialogDescription className="leading-relaxed text-ink/65">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-2 gap-2">
          <AlertDialogCancel asChild><ClayButton color="cream" disabled={busy}>Cancel</ClayButton></AlertDialogCancel>
          <ClayButton color={confirmColor} disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</ClayButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
