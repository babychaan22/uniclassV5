
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { AlertTriangle } from "lucide-react";

export default function AtRiskAlerts({ memberRows }) {
  const atRisk = memberRows.filter((r) => r.cls.tag === "At Risk");
  if (atRisk.length === 0) return null;

  return (
    <ClayCard color="coral" className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-5 h-5 text-white" />
        <h2 className="font-display font-bold text-sm text-white">At-Risk Students ({atRisk.length})</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {atRisk.map((r) => (
          <ClayChip key={r.member.id} color="cream">
            {r.member.last_name}, {r.member.first_name} · G{r.group?.group_number} · {r.cls.total}%
          </ClayChip>
        ))}
      </div>
    </ClayCard>
  );
}

