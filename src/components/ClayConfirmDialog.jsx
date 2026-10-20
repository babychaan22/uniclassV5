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

export default function ClayConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", confirmColor = "coral", busy = false, onConfirm }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100%-2rem)] rounded-3xl border-2 border-ink/10 bg-white p-5 shadow-[var(--uc-shadow-lg)] sm:p-6">
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
