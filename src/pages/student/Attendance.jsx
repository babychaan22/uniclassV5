
const db = globalThis.__B44_DB__;

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import ClayButton from "@/components/ClayButton";
import { getTodayManila } from "@/lib/week";
import { hasClassDays, isScheduledClassDay } from "@/lib/classDays";
import { ACTIVE_CLASS_CHANGED_EVENT, getActiveStudentAccount } from "@/lib/studentContext";
import { invalidateReadCache, supabase } from "@/api/supabaseClient";
import { Check, X, ClipboardCheck, Lock, CalendarDays, TrendingUp } from "lucide-react";
import RepresentativeRosterPanel from "@/components/student/RepresentativeRosterPanel";

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const dirtyRef = useRef(false);
  const today = getTodayManila();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) { setLoading(false); return; }
      // Keep the current roster visible during a background refresh. This is
      // especially important immediately after saving attendance, when a full
      // loading replacement used to throw the student back to the page top.
      if (!account) setLoading(true);
      setLoadError("");
      try {
        const a = await getActiveStudentAccount(user.id);
        if (!a) { setAccount(null); return; }
        const [classroomRecord, mem] = await Promise.all([
          db.entities.Classroom.get(a.classroom_id),
          db.entities.GroupMember.filter({ group_id: a.group_id, is_transferred: false }),
        ]);
        const [att, personalHistory] = await Promise.all([
          db.entities.Attendance.filter({ group_id: a.group_id, attendance_date: today }),
          db.entities.Attendance.filter({ classroom_id: a.classroom_id, group_member_id: a.group_member_id }, { orderBy: 'attendance_date', ascending: false }),
        ]);
        if (cancelled) return;
        const map = {};
        for (const r of att) map[r.group_member_id] = r;
        const init = {};
        for (const m of mem) init[m.id] = map[m.id]?.status || (a.is_representative ? "present" : null);
        setAccount(a);
        setClassroom(classroomRecord);
        setMembers(mem);
        setExisting(map);
        if (!dirtyRef.current || Object.keys(map).length > 0) { setStatuses(init); dirtyRef.current = false; }
        setHistory(personalHistory || []);
      } catch (error) {
        if (cancelled) return;
        console.error('[StudentAttendance] load failed', error);
        setLoadError('We could not load attendance right now. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const refresh = () => { invalidateReadCache('attendances'); setLoadVersion((current) => current + 1); };
    const classChanged = () => { dirtyRef.current = false; refresh(); };
    window.addEventListener(ACTIVE_CLASS_CHANGED_EVENT, classChanged);
    window.addEventListener('focus', refresh);
    window.addEventListener('uniclass-connection-restored', refresh);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
    return () => { cancelled = true; window.removeEventListener(ACTIVE_CLASS_CHANGED_EVENT, classChanged); window.removeEventListener('focus', refresh); window.removeEventListener('uniclass-connection-restored', refresh); window.clearInterval(timer); };
  }, [user, loadVersion, today]);

  const hasSchedule = hasClassDays(classroom?.class_days);
  const todayIsClassDay = !hasSchedule || isScheduledClassDay(new Date(`${today}T00:00:00Z`), classroom?.class_days);
  const canEdit = !!account?.is_representative && Object.keys(existing).length === 0 && todayIsClassDay;

  function setStatus(memberId, status) {
    if (!canEdit) return;
    dirtyRef.current = true;
    setStatuses((current) => ({ ...current, [memberId]: status }));
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    setSaveError("");
    try {
      const { error } = await supabase.rpc('submit_group_attendance', {
        p_group_id: account.group_id,
        p_attendance_date: today,
        p_statuses: statuses,
      });
      if (error) throw error;
      dirtyRef.current = false;
      invalidateReadCache('attendances');
      setLoadVersion((current) => current + 1);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('[StudentAttendance] save failed', error);
      setSaveError(error?.message || 'Attendance could not be saved. Nothing was recorded—please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !account) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  if (loadError && !account) return <div className="mx-auto max-w-lg py-8"><ClayCard color="coral" className="p-5 text-center"><p className="font-display text-lg font-extrabold">Attendance could not load</p><p className="mt-2 text-sm text-ink/70">{loadError}</p><ClayButton type="button" color="purple" className="mt-4" onClick={() => setLoadVersion((current) => current + 1)}>Try again</ClayButton></ClayCard></div>;

  if (!account) return <div className="mx-auto max-w-lg py-8"><ClayCard className="p-5 text-center"><p className="font-display font-bold">No approved class is available yet.</p><p className="mt-2 text-sm text-ink/70">Ask your teacher to approve your class request, then try again.</p><ClayButton type="button" color="purple" className="mt-4" onClick={() => { invalidateReadCache('group_accounts'); setLoadVersion((current) => current + 1); }}>Try again</ClayButton></ClayCard></div>;

  const rangeStart = (() => { if (historyRange === 'all') return null; const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - (Number(historyRange) - 1)); return date.toISOString().slice(0, 10); })();
  const visibleHistory = history.filter((record) => !rangeStart || record.attendance_date >= rangeStart);
  const presentHistory = visibleHistory.filter((record) => record.status === 'present').length;
  const attendanceRate = visibleHistory.length ? Math.round((presentHistory / visibleHistory.length) * 100) : 0;

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><ClipboardCheck className="w-6 h-6" /> Attendance</h1>
        <p className="text-ink/60 font-mono text-sm">{today}</p>
        {loadError && <p role="status" className="text-sm text-clay-coral">{loadError} Showing the last loaded records.</p>}
      </div>

      {!todayIsClassDay ? (
        <ClayCard color="sky" className="p-4 flex items-center gap-3">
          <CalendarDays className="w-5 h-5 shrink-0" />
          <p className="text-sm font-display font-bold">No class is scheduled today, so attendance and personal streaks are paused.</p>
        </ClayCard>
      ) : !canEdit && (
        <ClayCard color="sun" className="p-4 flex items-center gap-3">
          <Lock className="w-5 h-5 shrink-0" />
          <p className="text-sm font-display font-bold">{Object.keys(existing).length ? 'Attendance has been recorded. Only the teacher can make a correction.' : 'The group representative records attendance. No attendance has been recorded yet.'}</p>
        </ClayCard>
      )}

      <div className="space-y-3">
        {members.map((m) => {
          const present = statuses[m.id] === "present";
          const isMe = m.id === account.group_member_id;
          return (
            <ClayCard key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-display font-bold">{m.last_name}, {m.first_name}</p>
                {isMe && <ClayChip color="purple" className="mt-1">You</ClayChip>}
              </div>
              {canEdit ? (
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <button onClick={() => setStatus(m.id, "present")} className={`clay-btn w-full justify-center px-3 py-2 sm:w-auto sm:px-4 ${present ? "bg-clay-lime text-ink" : "bg-cream text-ink/40"}`}>
                    <Check className="w-5 h-5" /> Present
                  </button>
                  <button onClick={() => setStatus(m.id, "absent")} className={`clay-btn w-full justify-center px-3 py-2 sm:w-auto sm:px-4 ${!present ? "bg-clay-coral text-white" : "bg-cream text-ink/40"}`}>
                    <X className="w-5 h-5" /> Absent
                  </button>
                </div>
              ) : (
                <ClayChip color={existing[m.id]?.status === "present" ? "lime" : existing[m.id]?.status === "absent" ? "coral" : "cream"}>{existing[m.id]?.status === "present" ? "Present" : existing[m.id]?.status === "absent" ? "Absent" : "Not recorded"}</ClayChip>
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
      {saveError && <p role="alert" className="rounded-xl border-2 border-clay-coral/35 bg-clay-coral/10 p-3 text-sm font-semibold text-clay-coral">{saveError}</p>}

      <RepresentativeRosterPanel account={account} members={members} />

      <ClayCard className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display font-bold text-lg flex items-center gap-2"><CalendarDays className="w-5 h-5" /> My attendance history</h2><p className="text-xs text-ink/60 mt-1">Only your own attendance is shown here.</p></div><label className="text-xs font-display font-bold">View <select aria-label="Attendance history range" value={historyRange} onChange={(event) => setHistoryRange(event.target.value)} className="clay-input ml-1 w-auto py-1 text-xs"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="all">All</option></select></label></div>
        <div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-xl border-2 border-ink/15 bg-clay-lime/15 p-3 text-center"><TrendingUp className="mx-auto w-4 h-4 text-clay-lime" /><p className="font-mono font-extrabold text-xl">{attendanceRate}%</p><p className="text-[10px] font-display">PRESENT RATE</p></div><div className="rounded-xl border-2 border-ink/15 bg-cream p-3 text-center"><p className="font-mono font-extrabold text-xl">{presentHistory}/{visibleHistory.length}</p><p className="text-[10px] font-display">DAYS PRESENT</p></div></div>
        {visibleHistory.length === 0 ? <p className="py-5 text-center text-sm text-ink/50">No attendance records in this period yet.</p> : <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">{visibleHistory.map((record) => <div key={record.id} className="flex items-center justify-between rounded-xl border-2 border-ink/10 bg-cream px-3 py-2"><span className="text-sm font-display font-bold">{new Date(`${record.attendance_date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span><ClayChip color={record.status === 'present' ? 'lime' : 'coral'}>{record.status === 'present' ? 'Present' : 'Absent'}</ClayChip></div>)}</div>}
      </ClayCard>
    </div>
  );
}
