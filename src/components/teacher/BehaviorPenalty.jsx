
import { useState } from "react";
import ClayCard from "@/components/ClayCard";
import ClayButton from "@/components/ClayButton";
import ClayChip from "@/components/ClayChip";
import { AlertTriangle, Loader2 } from "lucide-react";

const PENALTY_REASONS = [
  { value: "Talking Out of Turn", label: "Talking Out of Turn — speaking without raising their hands" },
  { value: "Inattentiveness", label: "Inattentiveness — disengaged or distracted" },
  { value: "Disruptive Behavior", label: "Disruptive Behavior — noise, notes, or horseplay" },
  { value: "Inappropriate Language", label: "Inappropriate Language — foul or disrespectful language" },
];

export default function BehaviorPenalty({ groups, onPenalty, penaltyLogs, wholeGroupPointsByGroup = {} }) {
  const [groupId, setGroupId] = useState("");
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const available = Math.max(0, Number(wholeGroupPointsByGroup[groupId] || 0));
  const requested = Number(points || 0);
  const exceedsWholeGroupPoints = requested > available;

  async function submit(e) {
    e.preventDefault();
    if (!groupId || !points) return;
    setSaving(true);
    setError("");
    try {
      if (Number(points) > available) throw new Error(`Only ${available} whole-group point${available === 1 ? " is" : "s are"} available to deduct.`);
      // The protected action persists a group-only negative ledger entry.
      await onPenalty(groupId, Number(points), note.trim() || null);
      setGroupId(""); setPoints(""); setNote("");
    } catch (err) {
      setError(err.message || "Could not apply that penalty.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ClayCard className="p-4">
      <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-clay-coral" /> Behavior Penalty</h2>
      <p className="text-[11px] text-ink/55 mb-3">Deduct only from the group’s shared points. Personal student points, rankings, and grades are never reduced.</p>
      <form onSubmit={submit} className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Group</label>
          <select className="clay-input" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
            <option value="">Select</option>
            {groups.map((g) => <option key={g.id} value={g.id}>Group {g.group_number}</option>)}
          </select>
        </div>
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Whole-group points to deduct</label>
          <input type="number" min="1" max={Math.min(100, available)} className="clay-input font-mono" value={points} onChange={(e) => setPoints(e.target.value)} required />
          {groupId && <p className="mt-1 text-[11px] text-ink/55">{available} whole-group point{available === 1 ? "" : "s"} available</p>}
        </div>
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Reason</label>
          <select className="clay-input" value={note} onChange={(e) => setNote(e.target.value)} required>
            <option value="">Select a reason</option>
            {PENALTY_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-3">
          <ClayButton type="submit" color="coral" size="sm" disabled={saving || !groupId || !points || !note || exceedsWholeGroupPoints || available < 1}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply Penalty"}
          </ClayButton>
        </div>
      </form>
      {groupId && available < 1 && <p className="mt-2 text-xs font-bold text-clay-coral">This group has no shared points available for a deduction.</p>}
      {groupId && exceedsWholeGroupPoints && <p className="mt-2 text-xs font-bold text-clay-coral">A deduction cannot be larger than the group’s shared-points balance.</p>}
      {error && <p className="mt-2 text-xs font-bold text-clay-coral">{error}</p>}

      {penaltyLogs && penaltyLogs.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t-2 border-ink/15 pt-3">
          {penaltyLogs.map((l) => (
            <div key={l.id} className="flex items-center justify-between text-sm">
              <span className="font-body">G{l.groupNumber} · {l.note || "Penalty"}</span>
              <ClayChip color="coral">-{Math.abs(Number(l.points_awarded || 0))}</ClayChip>
            </div>
          ))}
        </div>
      )}
    </ClayCard>
  );
}

