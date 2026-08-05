
import { useState } from "react";
import ClayCard from "@/components/ClayCard";
import ClayButton from "@/components/ClayButton";
import ClayChip from "@/components/ClayChip";
import { AlertTriangle, Loader2 } from "lucide-react";

export default function BehaviorPenalty({ classroom, groups, onPenalty, penaltyLogs }) {
  const [groupId, setGroupId] = useState("");
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!groupId || !points) return;
    setSaving(true);
    await onPenalty(groupId, Number(points), note);
    setGroupId(""); setPoints(""); setNote("");
    setSaving(false);
  }

  return (
    <ClayCard className="p-4">
      <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-clay-coral" /> Behavior Penalty</h2>
      <form onSubmit={submit} className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Group</label>
          <select className="clay-input" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
            <option value="">Select</option>
            {groups.map((g) => <option key={g.id} value={g.id}>Group {g.group_number}</option>)}
          </select>
        </div>
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Penalty Pts</label>
          <input type="number" min="1" className="clay-input font-mono" value={points} onChange={(e) => setPoints(e.target.value)} required />
        </div>
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Note</label>
          <input className="clay-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" />
        </div>
        <div className="sm:col-span-3">
          <ClayButton type="submit" color="coral" size="sm" disabled={saving || !groupId || !points}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply Penalty"}
          </ClayButton>
        </div>
      </form>

      {penaltyLogs && penaltyLogs.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t-2 border-ink/15 pt-3">
          {penaltyLogs.map((l) => (
            <div key={l.id} className="flex items-center justify-between text-sm">
              <span className="font-body">G{l.groupNumber} · {l.note || "Penalty"}</span>
              <ClayChip color="coral">-{l.points_awarded}</ClayChip>
            </div>
          ))}
        </div>
      )}
    </ClayCard>
  );
}

