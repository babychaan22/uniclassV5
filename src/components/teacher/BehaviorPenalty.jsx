
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

export default function BehaviorPenalty({ groups, onPenalty, penaltyLogs }) {
  const [groupId, setGroupId] = useState("");
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!groupId || !points) return;
    setSaving(true);
    setError("");
    try {
      // The teacher enters the magnitude; the protected action persists -points.
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
      <p className="text-[11px] text-ink/55 mb-3">Apply a deduction to every student in a group. It is saved and displayed as a negative value in each student’s history.</p>
      <form onSubmit={submit} className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Group</label>
          <select className="clay-input" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
            <option value="">Select</option>
            {groups.map((g) => <option key={g.id} value={g.id}>Group {g.group_number}</option>)}
          </select>
        </div>
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Points to deduct</label>
          <input type="number" min="1" max="100" className="clay-input font-mono" value={points} onChange={(e) => setPoints(e.target.value)} required />
        </div>
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Reason</label>
          <select className="clay-input" value={note} onChange={(e) => setNote(e.target.value)} required>
            <option value="">Select a reason</option>
            {PENALTY_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-3">
          <ClayButton type="submit" color="coral" size="sm" disabled={saving || !groupId || !points || !note}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply Penalty"}
          </ClayButton>
        </div>
      </form>
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

