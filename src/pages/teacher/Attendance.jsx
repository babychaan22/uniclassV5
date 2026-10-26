const db = globalThis.__B44_DB__;

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";
import { invalidateReadCache, supabase } from "@/api/supabaseClient";
import { getTodayManila } from "@/lib/week";
import { ROUTES } from "@/lib/routes";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import FloatingNotice from "@/components/FloatingNotice";
import { CalendarDays, Check, ClipboardCheck, RefreshCw, X } from "lucide-react";

const fullName = (member) => [member?.last_name, member?.first_name].filter(Boolean).join(", ") || "Student";

export default function TeacherAttendance() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedDate, setSelectedDate] = useState(getTodayManila());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [message, setMessage] = useState("");
  const [noticeAnchor, setNoticeAnchor] = useState(null);
  const loadSequenceRef = useRef(0);

  async function load({ showSpinner = true } = {}) {
    const sequence = ++loadSequenceRef.current;
    if (!user) return;
    if (showSpinner) setLoading(true);
    try {
      const activeClassroom = await getTeacherClassroom(user.id);
      if (!activeClassroom) {
        if (sequence === loadSequenceRef.current) navigate(ROUTES.TEACHER.ONBOARDING);
        return;
      }
      // Query just the selected day: fetching the entire year can silently hit
      // the database row limit and omit the date the teacher is viewing.
      const [dataset, attendance] = await Promise.all([
        getClassroomDataset(activeClassroom.id, ["groups", "members"]),
        db.entities.Attendance.filter({ classroom_id: activeClassroom.id, attendance_date: selectedDate }),
      ]);
      // A save or newer refresh happened while this request was in flight.
      // Its result is authoritative, so never let this older payload replace it.
      if (sequence !== loadSequenceRef.current) return;
      setClassroom(activeClassroom);
      setGroups(dataset.groups || []);
      setMembers((dataset.members || []).slice().sort((a, b) => fullName(a).localeCompare(fullName(b))));
      setRecords(attendance || []);
    } catch (error) {
      if (sequence === loadSequenceRef.current) setMessage(error?.message || 'Attendance could not load. Please try again.');
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const refreshInPlace = () => {
      invalidateClassroomDataset();
      // The classroom dataset cache is not the only cache involved. Clear the
      // attendance query cache too, otherwise a record saved by a student on
      // another device can be re-read from this browser's stale response.
      invalidateReadCache("attendances");
      void load({ showSpinner: false }).catch((error) => {
        setMessage(error?.message || "Attendance could not be refreshed. Please try again.");
      });
    };
    window.addEventListener('uniclass-connection-restored', refreshInPlace);
    window.addEventListener('focus', refreshInPlace);
    // Realtime is immediate when available. This quiet, visible-page fallback
    // keeps the roster in sync when a browser or network blocks realtime.
    const syncTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshInPlace();
    }, 15000);
    return () => {
      window.removeEventListener('uniclass-connection-restored', refreshInPlace);
      window.removeEventListener('focus', refreshInPlace);
      window.clearInterval(syncTimer);
    };
  }, [user, selectedDate]);

  useEffect(() => {
    if (!classroom?.id) return undefined;
    // Student representatives save attendance from a different device. Listen
    // for those rows and refresh only this page's data; never remount the
    // teacher workspace or replace the roster with a spinner.
    const channel = supabase
      .channel(`teacher-attendance-${classroom.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'attendances', filter: `classroom_id=eq.${classroom.id}`,
      }, () => {
        invalidateClassroomDataset();
        invalidateReadCache("attendances");
        void load({ showSpinner: false }).catch((error) => {
          setMessage(error?.message || "Attendance could not be refreshed. Please try again.");
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [classroom?.id, user, selectedDate]);

  const attendanceByMember = useMemo(() => Object.fromEntries(
    records.filter((record) => record.attendance_date === selectedDate).map((record) => [record.group_member_id, record]),
  ), [records, selectedDate]);

  const sections = useMemo(() => {
    if (!classroom?.uses_groups) return [{ id: "class", title: "Whole class", members }];
    return groups.slice().sort((a, b) => a.group_number - b.group_number).map((group) => ({
      id: group.id,
      groupId: group.id,
      title: `Group ${group.group_number}`,
      members: members.filter((member) => member.group_id === group.id),
    }));
  }, [classroom, groups, members]);

  async function setStatus(member, status, sourceElement) {
    if (!classroom || savingId) return;
    setSavingId(member.id);
    setMessage("");
    setNoticeAnchor(sourceElement || null);
    try {
      const existing = attendanceByMember[member.id];
      let saved;
      if (existing) {
        saved = await db.entities.Attendance.update(existing.id, { status, marked_by: user.id });
      } else {
        try {
          saved = await db.entities.Attendance.create({
            classroom_id: classroom.id,
            group_id: member.group_id,
            group_member_id: member.id,
            attendance_date: selectedDate,
            status,
            marked_by: user.id,
          });
        } catch (error) {
          // A representative or another teacher can save in the small gap
          // between a quiet refresh and this click. The database rightfully
          // rejects a second row; find that row and apply the teacher's
          // intended correction instead of leaving the control in an error.
          if (error?.code !== "23505") throw error;
          invalidateReadCache("attendances");
          const matching = await db.entities.Attendance.filter({
            group_member_id: member.id,
            attendance_date: selectedDate,
          });
          if (!matching[0]) throw error;
          // Some legacy rows predate the current classroom assignment. Keep
          // the one-row-per-student-per-day rule, but repair its ownership so
          // it is visible in the active classroom immediately afterwards.
          saved = await db.entities.Attendance.update(matching[0].id, {
            classroom_id: classroom.id,
            group_id: member.group_id,
            status,
            marked_by: user.id,
          });
        }
      }
      // Show the confirmed value in this exact row immediately. A quiet
      // background read still reconciles concurrent edits from a student
      // representative or another teacher device, but the teacher never has
      // to wait for it just to see their own edit.
      setRecords((current) => {
        const withoutPrevious = current.filter((record) => record.id !== saved.id && !(record.group_member_id === member.id && record.attendance_date === selectedDate));
        return [...withoutPrevious, saved];
      });
      // Stop any request that started before this confirmed save from putting
      // an out-of-date snapshot back over the newly coloured row.
      loadSequenceRef.current += 1;
      invalidateClassroomDataset();
      setMessage(`${fullName(member)} marked ${status}.`);
    } catch (error) {
      setMessage(error?.message || "Attendance could not be saved. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  // Do not replace a teacher's roster while a manual refresh is in progress.
  // The controls remain usable and the updated record swaps in when ready.
  if (loading && !classroom) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-clay-purple border-t-transparent" /></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-display font-extrabold"><ClipboardCheck className="h-6 w-6" /> Class attendance</h1>
        <p className="mt-1 text-sm text-ink/60">Choose a date, then add or correct each student’s attendance. Teacher changes are saved immediately.</p>
      </div>

      <ClayCard className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block text-sm font-display font-bold">Attendance date
            <span className="mt-1 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-clay-purple" /><input aria-label="Attendance date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="clay-input w-auto py-2 text-sm" /></span>
          </label>
          <button type="button" onClick={load} className="clay-btn bg-cream px-3 py-2 text-sm text-ink" aria-label="Refresh attendance records"><RefreshCw className="h-4 w-4" /> Refresh</button>
        </div>
      </ClayCard>

      <div className="space-y-4">
        {sections.map((section) => (
          <ClayCard key={section.id} className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className="inline-flex items-center gap-1 font-display text-lg font-extrabold">{section.title} <GroupBadgeMarkers groupId={section.groupId} /></h2><ClayChip color="purple">{section.members.length} students</ClayChip></div>
            {section.members.length === 0 ? <p className="py-3 text-sm text-ink/55">No students are in this group yet.</p> : <div className="grid gap-2 sm:grid-cols-2">{section.members.map((member) => {
              const status = attendanceByMember[member.id]?.status;
              const busy = savingId === member.id;
              return <div key={member.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink/10 bg-cream p-3">
                <div className="min-w-0"><p className="truncate text-sm font-display font-bold">{fullName(member)}</p><p className="mt-0.5 text-xs text-ink/55">{status ? "Saved record" : "No record yet"}</p></div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" disabled={busy} onClick={(event) => setStatus(member, "present", event.currentTarget)} className={`clay-btn px-2.5 py-2 text-xs ${status === "present" ? "bg-clay-lime text-ink" : "bg-cream text-ink/70"}`} aria-label={`Mark ${fullName(member)} present`}><Check className="h-4 w-4" /> Present</button>
                  <button type="button" disabled={busy} onClick={(event) => setStatus(member, "absent", event.currentTarget)} className={`clay-btn px-2.5 py-2 text-xs ${status === "absent" ? "bg-clay-coral text-white" : "bg-cream text-ink/70"}`} aria-label={`Mark ${fullName(member)} absent`}><X className="h-4 w-4" /> Absent</button>
                </div>
              </div>;
            })}</div>}
          </ClayCard>
        ))}
      </div>
      <FloatingNotice notice={message ? { ok: !message.toLowerCase().includes("could not"), text: message } : null} anchorElement={noticeAnchor} onDismiss={() => setMessage("")} />
    </div>
  );
}
