
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import ClayButton from "@/components/ClayButton";
import { getTodayManila } from "@/lib/week";
import { hasClassDays, isScheduledClassDay } from "@/lib/classDays";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { Check, X, ClipboardCheck, Lock, CalendarDays, TrendingUp } from "lucide-react";

export default function StudentAttendance() {
  const { user } = useAuth();
  const [account, setAccount] = useState(null);
  const [members, setMembers] = useState([]);
  const [existing, setExisting] = useState({});
  const [statuses, setStatuses] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyRange, setHistoryRange] = useState("30");
  const [classroom, setClassroom] = useState(null);
  const today = getTodayManila();

  useEffect(() => {
    async function load() {
      if (!user) return;
      const a = await getActiveStudentAccount(user.id);
      if (!a) return;
      setAccount(a);
      const [classroomRecord, mem] = await Promise.all([
        db.entities.Classroom.get(a.classroom_id),
        db.entities.GroupMember.filter({ group_id: a.group_id }),
      ]);
      setClassroom(classroomRecord);
      setMembers(mem);
      const [att, personalHistory] = await Promise.all([
        db.entities.Attendance.filter({ group_id: a.group_id, attendance_date: today }),
        db.entities.Attendance.filter({ classroom_id: a.classroom_id, group_member_id: a.group_member_id }, { orderBy: 'attendance_date', ascending: false }),
      ]);
      const map = {};
      for (const r of att) map[r.group_member_id] = r;
      setExisting(map);
      const init = {};
      for (const m of mem) init[m.id] = map[m.id]?.status || "present";
      setStatuses(init);
      setHistory(personalHistory || []);
    }
    load();
  }, [user]);

  const hasSchedule = hasClassDays(classroom?.class_days);
  const todayIsClassDay = !hasSchedule || isScheduledClassDay(new Date(`${today}T00:00:00Z`), classroom?.class_days);
  const canEdit = !!account?.is_representative && Object.keys(existing).length === 0 && todayIsClassDay;

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

  const rangeStart = (() => { if (historyRange === 'all') return null; const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - (Number(historyRange) - 1)); return date.toISOString().slice(0, 10); })();
  const visibleHistory = history.filter((record) => !rangeStart || record.attendance_date >= rangeStart);
  const presentHistory = visibleHistory.filter((record) => record.status === 'present').length;
  const attendanceRate = visibleHistory.length ? Math.round((presentHistory / visibleHistory.length) * 100) : 0;

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><ClipboardCheck className="w-6 h-6" /> Attendance</h1>
        <p className="text-ink/60 font-mono text-sm">{today}</p>
      </div>

      {!todayIsClassDay ? (
        <ClayCard color="sky" className="p-4 flex items-center gap-3">
          <CalendarDays className="w-5 h-5 shrink-0" />
          <p className="text-sm font-display font-bold">No class is scheduled today, so attendance and personal streaks are paused.</p>
        </ClayCard>
      ) : !canEdit && (
        <ClayCard color="sun" className="p-4 flex items-center gap-3">
          <Lock className="w-5 h-5 shrink-0" />
          <p className="text-sm font-display font-bold">Attendance is locked after the representative saves it. Only the teacher can make a correction.</p>
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
        <ClayButton color="purple" size="lg" className="w-full" onClick={save} disabled={saving || Object.keys(existing).length > 0}>
          {saving ? "Saving..." : saved ? "Saved!" : "Save Attendance"}
        </ClayButton>
      )}

      <ClayCard className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display font-bold text-lg flex items-center gap-2"><CalendarDays className="w-5 h-5" /> My attendance history</h2><p className="text-xs text-ink/60 mt-1">Only your own attendance is shown here.</p></div><label className="text-xs font-display font-bold">View <select aria-label="Attendance history range" value={historyRange} onChange={(event) => setHistoryRange(event.target.value)} className="clay-input ml-1 w-auto py-1 text-xs"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="all">All</option></select></label></div>
        <div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-xl border-2 border-ink/15 bg-clay-lime/15 p-3 text-center"><TrendingUp className="mx-auto w-4 h-4 text-clay-lime" /><p className="font-mono font-extrabold text-xl">{attendanceRate}%</p><p className="text-[10px] font-display">PRESENT RATE</p></div><div className="rounded-xl border-2 border-ink/15 bg-cream p-3 text-center"><p className="font-mono font-extrabold text-xl">{presentHistory}/{visibleHistory.length}</p><p className="text-[10px] font-display">DAYS PRESENT</p></div></div>
        {visibleHistory.length === 0 ? <p className="py-5 text-center text-sm text-ink/50">No attendance records in this period yet.</p> : <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">{visibleHistory.map((record) => <div key={record.id} className="flex items-center justify-between rounded-xl border-2 border-ink/10 bg-cream px-3 py-2"><span className="text-sm font-display font-bold">{new Date(`${record.attendance_date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span><ClayChip color={record.status === 'present' ? 'lime' : 'coral'}>{record.status === 'present' ? 'Present' : 'Absent'}</ClayChip></div>)}</div>}
      </ClayCard>
    </div>
  );
}
