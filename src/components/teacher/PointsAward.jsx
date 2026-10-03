
import { useState } from "react";
import ClayCard from "@/components/ClayCard";
import ClayButton from "@/components/ClayButton";
import { Award, Loader2 } from "lucide-react";

// Points a teacher hands out by hand: helping, extra effort, a job well done.
// It lands in the same ledger as a QR scan, so the student's history explains
// where every point came from.
export default function PointsAward({ groups, members, onAward }) {
  const [memberId, setMemberId] = useState("");
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const groupNumber = (groupId) => {
    const group = groups.find((g) => g.id === groupId);
    return group ? `Group ${group.group_number}` : "Unassigned";
  };

  async function submit(e) {
    e.preventDefault();
    if (!memberId || !points) return;
    const member = members.find((m) => m.id === memberId);
    if (!member) return;
    setSaving(true);
    setError("");
    try {
      await onAward(member.group_id, Number(points), member.id, note.trim() || null);
      setMemberId(""); setPoints(""); setNote("");
    } catch (err) {
      setError(err.message || "Could not award those points.");
    } finally {
      setSaving(false);
    }
  }

  const amount = Number(points);
  const tooMuch = points !== "" && (!Number.isFinite(amount) || amount <= 0 || amount > 100);

  return (
    <ClayCard className="p-4">
      <h2 className="font-display font-bold text-sm mb-1 flex items-center gap-2">
        <Award className="w-4 h-4 text-clay-lime" /> Award points
      </h2>
      <p className="text-[11px] text-ink/55 mb-3">
        Give a student points for anything a QR code cannot record. The student sees it in their
        account history as a manual award.
      </p>
      <form onSubmit={submit} className="grid sm:grid-cols-[2fr_1fr_2fr_auto] gap-3 items-end">
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Student</label>
          <select className="clay-input" value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
            <option value="">Select a student</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {groupNumber(m.group_id)} · {m.last_name}, {m.first_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Points</label>
          <input
            type="number"
            min="1"
            max="100"
            className="clay-input font-mono"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="font-display font-bold text-xs mb-1 block">Reason</label>
          <input
            className="clay-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Helped with the display"
          />
        </div>
        <ClayButton type="submit" color="lime" size="sm" disabled={saving || !memberId || !points || tooMuch}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Award"}
        </ClayButton>
      </form>
      {tooMuch && <p className="mt-2 text-xs font-bold text-clay-coral">Enter between 1 and 100 points.</p>}
      {error && <p className="mt-2 text-xs font-bold text-clay-coral">{error}</p>}
    </ClayCard>
  );
}
