
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import ClayButton from "@/components/ClayButton";
import { getTodayManila } from "@/lib/week";
import { Check, X, ClipboardCheck, Lock } from "lucide-react";

export default function StudentAttendance() {
  const { user } = useAuth();
  const [account, setAccount] = useState(null);
  const [members, setMembers] = useState([]);
  const [existing, setExisting] = useState({});
  const [statuses, setStatuses] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const today = getTodayManila();

  useEffect(() => {
    async function load() {
      if (!user) return;
      const acc = await db.entities.GroupAccount.filter({ user_id: user.id });
      const a = acc[0];
      setAccount(a);
      const mem = await db.entities.GroupMember.filter({ group_id: a.group_id });
      setMembers(mem);
      const att = await db.entities.Attendance.filter({ group_id: a.group_id, attendance_date: today });
      const map = {};
      for (const r of att) map[r.group_member_id] = r;
      setExisting(map);
      const init = {};
      for (const m of mem) init[m.id] = map[m.id]?.status || "present";
      setStatuses(init);
    }
    load();
  }, [user]);

  const canEdit = !!account?.is_representative;

  function toggle(memberId) {
    if (!canEdit) return;
    setStatuses({ ...statuses, [memberId]: statuses[memberId] === "present" ? "absent" : "present" });
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    for (const m of members) {
      const status = statuses[m.id];
      const ex = existing[m.id];
      if (ex) {
        if (ex.status !== status) {
          await db.entities.Attendance.update(ex.id, { status, marked_by: user.id });
        }
      } else {
        await db.entities.Attendance.create({
          group_member_id: m.id, group_id: account.group_id, classroom_id: account.classroom_id,
          attendance_date: today, status, marked_by: user.id,
        });
      }
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!account) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><ClipboardCheck className="w-6 h-6" /> Attendance</h1>
        <p className="text-ink/60 font-mono text-sm">{today}</p>
      </div>

      {!canEdit && (
        <ClayCard color="sun" className="p-4 flex items-center gap-3">
          <Lock className="w-5 h-5 shrink-0" />
          <p className="text-sm font-display font-bold">Only your group representative can update attendance. You're viewing today's status.</p>
        </ClayCard>
      )}

      <div className="space-y-3">
        {members.map((m) => {
          const present = statuses[m.id] === "present";
          const isMe = m.id === account.group_member_id;
          return (
            <ClayCard key={m.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-display font-bold">{m.last_name}, {m.first_name}</p>
                {isMe && <ClayChip color="purple" className="mt-1">You</ClayChip>}
              </div>
              {canEdit ? (
                <div className="flex gap-2">
                  <button onClick={() => toggle(m.id)} className={`clay-btn px-4 py-2 ${present ? "bg-clay-lime text-ink" : "bg-cream text-ink/40"}`}>
                    <Check className="w-5 h-5" /> Present
                  </button>
                  <button onClick={() => toggle(m.id)} className={`clay-btn px-4 py-2 ${!present ? "bg-clay-coral text-white" : "bg-cream text-ink/40"}`}>
                    <X className="w-5 h-5" /> Absent
                  </button>
                </div>
              ) : (
                <ClayChip color={present ? "lime" : "coral"}>{present ? "Present" : "Absent"}</ClayChip>
              )}
            </ClayCard>
          );
        })}
      </div>

      {canEdit && (
        <ClayButton color="purple" size="lg" className="w-full" onClick={save} disabled={saving}>
          {saving ? "Saving..." : saved ? "Saved!" : "Save Attendance"}
        </ClayButton>
      )}
    </div>
  );
}
