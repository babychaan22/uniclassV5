
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { invalidateTeacherClassroom, invalidateClassroomContext } from "@/lib/teacherClassroom";
import { createClassroom } from "@/lib/secureActions";
import { deleteClassroom } from "@/lib/secureActions";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import ClassDaySelector from "@/components/ClassDaySelector";
import { hasClassDays } from "@/lib/classDays";
import { Users, Check, X, Plus, Calendar, Hash, BookOpen, ChevronRight, Copy } from "lucide-react";

function genJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function TeacherOnboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classrooms, setClassrooms] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ grade_level: "Grade 8", section: "", subject: "", school_year: "2026-2027", num_groups: 8, uses_groups: true, class_days: [] });
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState([]);
  const [groups, setGroups] = useState([]);
  const [term, setTerm] = useState({ term_label: "Term 1", start_date: "", end_date: "" });
  const [terms, setTerms] = useState([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  function withTimeout(promise, label, ms = 20000) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out. Check your connection and try again.`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  const active = classrooms.find((c) => c.id === activeId) || null;

  useEffect(() => { load(); }, [user]);
  useEffect(() => { if (activeId) loadDetails(activeId); }, [activeId]);

  async function load() {
    if (!user) return;
    setLoading(true);
    try {
      const cr = await withTimeout(db.entities.Classroom.filter({ teacher_id: user.id }), "Loading classes");
      cr.sort((a, b) => (b.created_date || "").localeCompare(a.created_date || ""));
      setClassrooms(cr);
      if (cr.length > 0 && !activeId) setActiveId(cr[0].id);
    } catch (err) {
      setError(err?.message || "Unable to load your classes.");
    } finally { setLoading(false); }
  }

  async function loadDetails(classroomId) {
    try {
      const [accounts, g, t] = await withTimeout(Promise.all([
        db.entities.GroupAccount.filter({ classroom_id: classroomId, is_approved: false }),
        db.entities.Group.filter({ classroom_id: classroomId }),
        db.entities.GradingTerm.filter({ classroom_id: classroomId }),
      ]), "Loading class details");
      setPending(accounts);
      setGroups(g);
      setTerms(t);
    } catch (err) {
      setError(err?.message || "Unable to load class details.");
    }
  }

  async function createClass(e) {
    e.preventDefault();
    if (!hasClassDays(form.class_days)) {
      setError("Select the days this class meets before creating it.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const joinCode = genJoinCode();
      const cr = await withTimeout(createClassroom({
        p_grade_level: form.grade_level,
        p_section: form.section,
        p_subject: form.subject,
        p_school_year: form.school_year,
        p_num_groups: form.uses_groups ? form.num_groups : 0,
        p_uses_groups: form.uses_groups,
        p_join_code: joinCode,
      }), "Creating class");
      const classroom = await db.entities.Classroom.update(cr.id, { class_days: form.class_days });
      invalidateTeacherClassroom();
      invalidateClassroomContext();
      setClassrooms((prev) => [classroom, ...prev]);
      setActiveId(classroom.id);
      setForm({ grade_level: "Grade 8", section: "", subject: "", school_year: "2026-2027", num_groups: 8, uses_groups: true, class_days: [] });
    } catch (err) {
      setError(err?.message || "Class creation failed. Please try again.");
    } finally { setCreating(false); }
  }

  async function approve(account) {
    await db.entities.GroupAccount.update(account.id, { is_approved: true });
    if (activeId) loadDetails(activeId);
  }
  async function copyJoinCode() {
    await navigator.clipboard.writeText(active.join_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  async function reject(account) {
    await db.entities.GroupAccount.delete(account.id);
    if (activeId) loadDetails(activeId);
  }

  async function removeClass(classroom) {
    if (!window.confirm(`Delete ${classroom.grade_level} · ${classroom.section}? This removes its class data and cannot be undone.`)) return;
    setError("");
    try {
      await deleteClassroom(classroom.id);
      invalidateTeacherClassroom();
      invalidateClassroomContext();
      const remaining = classrooms.filter((item) => item.id !== classroom.id);
      setClassrooms(remaining);
      setActiveId(remaining[0]?.id || null);
    } catch (err) {
      setError(err?.message || "Class could not be deleted. Check that you are the class teacher.");
    }
  }

  async function createTerm(e) {
    e.preventDefault();
    for (const t of terms) { if (t.is_active) await db.entities.GradingTerm.update(t.id, { is_active: false }); }
    await db.entities.GradingTerm.create({
      classroom_id: active.id,
      term_label: term.term_label,
      start_date: term.start_date,
      end_date: term.end_date,
      is_active: true,
    });
    setTerm({ term_label: "Term 2", start_date: "", end_date: "" });
    loadDetails(active.id);
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><BookOpen className="w-6 h-6" /> Class Setup</h1>
        <p className="text-ink/60">Create a section class and subject, then share the class code with students.</p>
      </div>

      {error && <ClayCard color="coral" className="p-4 text-sm" role="alert">{error}</ClayCard>}

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">Create New Class</h2>
        <form onSubmit={createClass} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Grade Level</label>
              <input className="clay-input" value={form.grade_level} onChange={(e) => setForm({ ...form, grade_level: e.target.value })} required />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Section</label>
              <input className="clay-input" placeholder="e.g. Rizal" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="font-display font-bold text-xs mb-1 block">Subject</label>
            <input className="clay-input" placeholder="e.g. English / Math / Science" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-display font-bold text-xs mb-1 block">School Year</label>
              <input className="clay-input" value={form.school_year} onChange={(e) => setForm({ ...form, school_year: e.target.value })} required />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Number of Groups</label>
              <input type="number" min="1" max="12" className="clay-input" value={form.num_groups} onChange={(e) => setForm({ ...form, num_groups: Number(e.target.value) })} disabled={!form.uses_groups} required />
            </div>
          </div>
          <div className="rounded-xl border-2 border-ink/15 bg-cream p-3"><label className="flex items-center gap-2 font-display font-bold text-sm"><input type="checkbox" checked={form.uses_groups} onChange={(e) => setForm({ ...form, uses_groups: e.target.checked })} /> This class uses groups</label><p className="text-xs text-ink/50 mt-1">Turn off for individual students. Each student will have their own private access to attendance, scores, uploads, and representative tools.</p></div>
          <ClassDaySelector value={form.class_days} onChange={(class_days) => setForm({ ...form, class_days })} />
          <ClayButton type="submit" color="purple" size="md" className="w-full" disabled={creating}>
            <Plus className="w-4 h-4" /> {creating ? "Creating..." : "Create Class & Code"}
          </ClayButton>
        </form>
      </ClayCard>

      {classrooms.length > 0 && (
        <ClayCard className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Your Classes</h2>
          <div className="space-y-2">
            {classrooms.map((c) => {
              const sel = c.id === activeId;
              return (
                <button key={c.id} type="button" onClick={() => setActiveId(c.id)}
                  className={`w-full text-left clay-btn px-3 py-2.5 ${sel ? "bg-clay-purple text-white" : "bg-cream text-ink"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold">{c.grade_level} · {c.section}{c.subject ? ` · ${c.subject}` : ""}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs">{c.join_code}</span>
                      <span className="flex items-center gap-2">
                        {sel && <ChevronRight className="w-4 h-4" />}
                        <span role="button" tabIndex={0} className="text-xs underline text-clay-coral" onClick={(event) => { event.stopPropagation(); removeClass(c); }} onKeyDown={(event) => { if (event.key === "Enter") { event.stopPropagation(); removeClass(c); } }}>Delete</span>
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </ClayCard>
      )}

      {active && (
        <>
          <ClayCard color="purple" className="p-6 text-center">
            <p className="text-white/80 font-display font-bold text-sm mb-1 flex items-center justify-center gap-2">
              <Hash className="w-4 h-4" /> STUDENT CLASS CODE
            </p>
            <div className="flex items-center justify-center gap-3"><p className="text-4xl font-mono font-bold tracking-widest text-white">{active.join_code}</p><ClayButton color="sky" size="sm" onClick={copyJoinCode} aria-label="Copy class code">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? "Copied" : "Copy"}</ClayButton></div>
            <p className="text-white/70 text-sm mt-2">{active.grade_level} · {active.section} · {active.subject} · {active.school_year}</p>
            <p className="text-white/60 text-xs mt-1">Give this code to your students.</p>
          </ClayCard>

          <ClayCard className="p-5">
            <h2 className="font-display font-bold text-base mb-3 flex items-center gap-2"><Calendar className="w-5 h-5" /> Grading Term</h2>
            {terms.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {terms.map((t) => (
                  <ClayChip key={t.id} color={t.is_active ? "lime" : "cream"}>
                    {t.term_label} · {t.start_date} → {t.end_date} {t.is_active && "●"}
                  </ClayChip>
                ))}
              </div>
            )}
            <form onSubmit={createTerm} className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="font-display font-bold text-xs mb-1 block">Label</label>
                <input className="clay-input" value={term.term_label} onChange={(e) => setTerm({ ...term, term_label: e.target.value })} required />
              </div>
              <div>
                <label className="font-display font-bold text-xs mb-1 block">Start</label>
                <input type="date" className="clay-input" value={term.start_date} onChange={(e) => setTerm({ ...term, start_date: e.target.value })} required />
              </div>
              <div>
                <label className="font-display font-bold text-xs mb-1 block">End</label>
                <input type="date" className="clay-input" value={term.end_date} onChange={(e) => setTerm({ ...term, end_date: e.target.value })} required />
              </div>
              <div className="sm:col-span-3">
                <ClayButton type="submit" color="sky" size="md">Set Active Term</ClayButton>
              </div>
            </form>
          </ClayCard>

          <ClayCard className="p-5">
            <h2 className="font-display font-bold text-base mb-3 flex items-center gap-2"><Users className="w-5 h-5" /> Pending Group Accounts</h2>
            {pending.length === 0 ? (
              <p className="text-ink/50 text-sm">No pending accounts. Students waiting for approval will appear here.</p>
            ) : (
              <div className="space-y-2">
                {pending.map((a) => {
                  const gnum = groups.find((g) => g.id === a.group_id)?.group_number;
                  return (
                    <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border-2 border-ink/15 bg-cream">
                      <div>
                        <p className="font-display font-bold">{a.last_name}, {a.first_name}</p>
                        <p className="text-xs text-ink/50 font-mono">Group {gnum ?? "—"}{a.email ? ` · ${a.email}` : ""}</p>
                      </div>
                      <div className="flex gap-2">
                        <ClayButton color="lime" size="sm" onClick={() => approve(a)}><Check className="w-4 h-4" /> Approve</ClayButton>
                        <ClayButton color="coral" size="sm" onClick={() => reject(a)}><X className="w-4 h-4" /> Reject</ClayButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ClayCard>
        </>
      )}
    </div>
  );
}
