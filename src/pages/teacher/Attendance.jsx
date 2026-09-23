const db = globalThis.__B44_DB__;

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";
import { getTodayManila } from "@/lib/week";
import { ROUTES } from "@/lib/routes";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
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

  async function load() {
    if (!user) return;
    setLoading(true);
    const activeClassroom = await getTeacherClassroom(user.id);
    if (!activeClassroom) {
      navigate(ROUTES.TEACHER.ONBOARDING);
      return;
    }
    const dataset = await getClassroomDataset(activeClassroom.id, ["groups", "members", "attendance"]);
    setClassroom(activeClassroom);
    setGroups(dataset.groups || []);
    setMembers((dataset.members || []).slice().sort((a, b) => fullName(a).localeCompare(fullName(b))));
    setRecords(dataset.attendance || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [user]);

  const attendanceByMember = useMemo(() => Object.fromEntries(
    records.filter((record) => record.attendance_date === selectedDate).map((record) => [record.group_member_id, record]),
  ), [records, selectedDate]);

  const sections = useMemo(() => {
    if (!classroom?.uses_groups) return [{ id: "class", title: "Whole class", members }];
    return groups.slice().sort((a, b) => a.group_number - b.group_number).map((group) => ({
      id: group.id,
      title: `Group ${group.group_number}`,
      members: members.filter((member) => member.group_id === group.id),
    }));
  }, [classroom, groups, members]);

  async function setStatus(member, status) {
    if (!classroom || savingId) return;
    setSavingId(member.id);
    setMessage("");
    try {
      const existing = attendanceByMember[member.id];
      if (existing) {
        await db.entities.Attendance.update(existing.id, { status, marked_by: user.id });
      } else {
        await db.entities.Attendance.create({
          classroom_id: classroom.id,
          group_id: member.group_id,
          group_member_id: member.id,
          attendance_date: selectedDate,
          status,
          marked_by: user.id,
        });
      }
      invalidateClassroomDataset();
      await load();
      setMessage(`${fullName(member)} marked ${status}.`);
    } catch (error) {
      setMessage(error?.message || "Attendance could not be saved. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-clay-purple border-t-transparent" /></div>;

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
        {message && <p role="status" className="mt-3 rounded-lg bg-clay-sky/15 px-3 py-2 text-sm font-display font-bold text-ink">{message}</p>}
      </ClayCard>

      <div className="space-y-4">
        {sections.map((section) => (
          <ClayCard key={section.id} className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-display text-lg font-extrabold">{section.title}</h2><ClayChip color="purple">{section.members.length} students</ClayChip></div>
            {section.members.length === 0 ? <p className="py-3 text-sm text-ink/55">No students are in this group yet.</p> : <div className="grid gap-2 sm:grid-cols-2">{section.members.map((member) => {
              const status = attendanceByMember[member.id]?.status;
              const busy = savingId === member.id;
              return <div key={member.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink/10 bg-cream p-3">
                <div className="min-w-0"><p className="truncate text-sm font-display font-bold">{fullName(member)}</p><p className="mt-0.5 text-xs text-ink/55">{status ? "Saved record" : "No record yet"}</p></div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" disabled={busy} onClick={() => setStatus(member, "present")} className={`clay-btn px-2.5 py-2 text-xs ${status === "present" ? "bg-clay-lime text-ink" : "bg-cream text-ink/70"}`} aria-label={`Mark ${fullName(member)} present`}><Check className="h-4 w-4" /> Present</button>
                  <button type="button" disabled={busy} onClick={() => setStatus(member, "absent")} className={`clay-btn px-2.5 py-2 text-xs ${status === "absent" ? "bg-clay-coral text-white" : "bg-cream text-ink/70"}`} aria-label={`Mark ${fullName(member)} absent`}><X className="h-4 w-4" /> Absent</button>
                </div>
              </div>;
            })}</div>}
          </ClayCard>
        ))}
      </div>
    </div>
  );
}
