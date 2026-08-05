
import ClayCard from "@/components/ClayCard";
import ClayButton from "@/components/ClayButton";
import { Check, UserCheck } from "lucide-react";

export default function PendingApprovalBulk({ pending, groups, onApproveAll, onApproveOne }) {
  const gnum = (a) => groups.find((g) => g.id === a.group_id)?.group_number ?? "—";

  return (
    <ClayCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-bold text-sm flex items-center gap-2"><UserCheck className="w-4 h-4" /> Pending Approvals ({pending.length})</h2>
        <ClayButton size="sm" color="lime" onClick={onApproveAll}>
          <Check className="w-4 h-4" /> Approve All
        </ClayButton>
      </div>
      <div className="space-y-2">
        {pending.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-2.5 rounded-xl border-2 border-ink/15 bg-cream">
            <div>
              <p className="font-display font-bold text-sm">{a.last_name}, {a.first_name}</p>
              <p className="text-xs text-ink/50 font-mono">Group {gnum(a)}</p>
            </div>
            <ClayButton size="sm" color="lime" onClick={() => onApproveOne(a.id)}>
              <Check className="w-4 h-4" />
            </ClayButton>
          </div>
        ))}
      </div>
    </ClayCard>
  );
}

