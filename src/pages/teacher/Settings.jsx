
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, invalidateTeacherClassroom } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import UserAvatar, { AVATAR_OPTIONS, DEFAULT_STUDENT_AVATAR } from "@/components/visual/UserAvatar";
import { NovaAsset, UIAsset } from "@/components/visual/UIAsset";
import { Settings as SettingsIcon, Loader2, Save, Check, User, Calendar, RefreshCw, SlidersHorizontal, Hash, Trash2, Copy } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import ClassDaySelector from "@/components/ClassDaySelector";
import { hasClassDays, normalizeClassDays } from "@/lib/classDays";

const WEIGHT_KEYS = [
  { key: "weight_attendance", label: "Attendance" },
  { key: "weight_activity_scores", label: "Activity Scores" },
  { key: "weight_quizzes", label: "Quizzes" },
  { key: "weight_major_exams", label: "Major Exams" },
  { key: "weight_performance_tasks", label: "Performance Tasks" },
  { key: "weight_participation", label: "Participation" },
];

const TABS = [
  { id: "account", label: "Account", icon: User },
  { id: "class", label: "Class Display", icon: SettingsIcon },
  { id: "weights", label: "Grading Weights", icon: SlidersHorizontal },
  { id: "code", label: "Class Code", icon: Hash },
  { id: "terms", label: "Grading Terms", icon: Calendar },
];

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function TeacherSettings() {
  const { user, checkUserAuth } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [classroom, setClassroom] = useState(null);
  const [settings, setSettings] = useState(null);
  const [terms, setTerms] = useState([]);
  const [tab, setTab] = useState("account");
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [teacherAvatarKey, setTeacherAvatarKey] = useState(user?.avatar_key || DEFAULT_STUDENT_AVATAR);
  const [classForm, setClassForm] = useState(null);
  const [weights, setWeights] = useState(null);
  const [year, setYear] = useState("");
  const [termForm, setTermForm] = useState({ term_label: "Term 1", start_date: "", end_date: "" });
  const [saving, setSaving] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    let s = (await db.entities.ClassSettings.filter({ classroom_id: c.id }))[0];
    if (!s) s = await db.entities.ClassSettings.create({ classroom_id: c.id });
    const t = await db.entities.GradingTerm.filter({ classroom_id: c.id });
    setClassroom(c);
    setSettings(s);
    setTerms(t.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || "")));
    setClassForm({ grade_level: c.grade_level, section: c.section, subject: c.subject || "", school_year: c.school_year, class_days: normalizeClassDays(c.class_days) });
    setWeights(Object.fromEntries(WEIGHT_KEYS.map((w) => [w.key, s[w.key] ?? 0])));
    setYear(c.school_year || "");
    setFullName(user.full_name || "");
    setLoading(false);
  }

  function flash(ok, text) { setMsg({ ok, text }); setTimeout(() => setMsg(null), 2500); }

  async function saveAccount() {
    setSaving("account");
    await db.auth.updateMe({ full_name: fullName });
    setSaving(null);
    flash(true, "Account info saved.");
  }

  async function selectTeacherAvatar(avatarKey) {
    setSaving("avatar");
    try {
      await db.auth.updateMe({ avatar_key: avatarKey });
      setTeacherAvatarKey(avatarKey);
      await checkUserAuth();
      flash(true, "Teacher avatar updated.");
    } catch (error) {
      flash(false, error.message || "Your avatar could not be updated.");
    } finally {
      setSaving(null);
    }
  }

  async function saveClass() {
    if (!hasClassDays(classForm.class_days)) {
      flash(false, "Select at least one class meeting day.");
      return;
    }
    setSaving("class");
    await db.entities.Classroom.update(classroom.id, classForm);
    invalidateTeacherClassroom();
    setClassroom({ ...classroom, ...classForm });
    setSaving(null);
    flash(true, "Class details and meeting days updated.");
  }

  async function saveWeights() {
    const sum = WEIGHT_KEYS.reduce((s, w) => s + Number(weights[w.key] || 0), 0);
    if (sum !== 100) { flash(false, `Weights must total 100 (currently ${sum}).`); return; }
    setSaving("weights");
    await db.entities.ClassSettings.update(settings.id, weights);
    setSaving(null);
    flash(true, "Grading weights saved.");
  }

  async function resetCode() {
    setSaving("code");
    const code = genCode();
    await db.entities.Classroom.update(classroom.id, { join_code: code });
    invalidateTeacherClassroom();
    setClassroom({ ...classroom, join_code: code });
    setSaving(null);
    flash(true, "Class code reset.");
  }
  async function copyJoinCode() {
    await navigator.clipboard.writeText(classroom.join_code);
    flash(true, "Class code copied.");
  }

  async function saveYear() {
    setSaving("year");
    await db.entities.Classroom.update(classroom.id, { school_year: year });
    invalidateTeacherClassroom();
    setClassroom({ ...classroom, school_year: year });
    setSaving(null);
    flash(true, "Academic year saved.");
  }

  async function createTerm(e) {
    e.preventDefault();
    setSaving("term");
    for (const t of terms) { if (t.is_active) await db.entities.GradingTerm.update(t.id, { is_active: false }); }
    await db.entities.GradingTerm.create({
      classroom_id: classroom.id,
      term_label: termForm.term_label,
      start_date: termForm.start_date,
      end_date: termForm.end_date,
      is_active: true,
    });
    setTermForm({ term_label: `Term ${terms.length + 2}`, start_date: "", end_date: "" });
    setSaving(null);
    flash(true, "Term created and set active.");
    load();
  }

  async function setActiveTerm(t) {
    for (const x of terms) { if (x.is_active && x.id !== t.id) await db.entities.GradingTerm.update(x.id, { is_active: false }); }
    await db.entities.GradingTerm.update(t.id, { is_active: true });
    load();
  }

  async function removeTerm(id) {
    await db.entities.GradingTerm.delete(id);
    load();
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  const weightSum = WEIGHT_KEYS.reduce((s, w) => s + Number(weights[w.key] || 0), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <section className="uc-card relative overflow-hidden px-5 py-5 sm:px-7 sm:py-6">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--uc-purple)]">Account & classroom preferences</p>
            <h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Settings</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink/60">Keep your profile, class details, grading setup, and terms organized in one friendly place.</p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-[var(--uc-purple-soft)] px-4 py-3 sm:min-w-[240px]">
            <NovaAsset pose="profile" className="h-14 w-14 shrink-0" />
            <UserAvatar name={user?.email || user?.full_name} avatarKey={teacherAvatarKey} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-extrabold text-[var(--uc-navy-950)]">{fullName || "Teacher"}</p>
              <p className="truncate text-xs text-ink/60">Teacher account</p>
            </div>
          </div>
        </div>
      </section>

      {msg && <p className={`font-display font-bold text-sm ${msg.ok ? "text-clay-lime" : "text-clay-coral"}`}>{msg.text}</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="uc-card flex gap-2 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} aria-current={active ? "page" : undefined}
                className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-display font-bold transition-colors ${active ? "bg-[var(--uc-purple-soft)] text-[var(--uc-navy-950)]" : "text-ink/60 hover:bg-[var(--uc-purple-soft)]/60 hover:text-[var(--uc-navy-950)]"}`}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${active ? "bg-white shadow-[var(--uc-shadow-sm)]" : "bg-[var(--uc-bg)]"}`}>
                  <Icon className={`h-4 w-4 ${active ? "text-[var(--uc-purple)]" : "text-ink/55"}`} />
                </span>
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-4">
      {tab === "account" && (
        <ClayCard className="p-5 space-y-3">
          <div className="flex items-center gap-3 border-b border-ink/5 pb-4">
            <UserAvatar name={user?.email || fullName} avatarKey={teacherAvatarKey} size="lg" />
            <div>
              <h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Profile information</h2>
              <p className="text-sm text-ink/60">This name appears across your classrooms.</p>
            </div>
          </div>
          <div>
            <label className="font-display font-bold text-xs mb-1 block">Email (read-only)</label>
            <input className="clay-input opacity-60" value={user.email || ""} readOnly />
          </div>
          <div>
            <label className="font-display font-bold text-xs mb-1 block">Display Name</label>
            <input className="clay-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <p className="font-display font-bold text-xs">Choose your teacher avatar</p>
            <p className="mt-1 text-xs text-ink/60">This appears in your header and teacher workspace.</p>
            <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-6">
              {AVATAR_OPTIONS.map((avatar) => {
                const selected = teacherAvatarKey === avatar.id;
                return <button key={avatar.id} type="button" aria-label={`Use ${avatar.label}`} aria-pressed={selected} disabled={saving === "avatar"} onClick={() => selectTeacherAvatar(avatar.id)} className={`rounded-xl border-2 p-1.5 transition ${selected ? "border-[var(--uc-purple)] bg-[var(--uc-purple-soft)]" : "border-transparent bg-[var(--uc-bg)] hover:border-[var(--uc-purple)]/35"}`}><img src={avatar.src} alt="" aria-hidden="true" className="mx-auto h-10 w-10 rounded-full border-2 border-white bg-white shadow-sm" loading="lazy" /></button>;
              })}
            </div>
          </div>
          <ClayButton color="purple" size="sm" onClick={saveAccount} disabled={saving === "account"}>
            {saving === "account" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save Account</>}
          </ClayButton>
        </ClayCard>
      )}

      {tab === "class" && (
        <ClayCard className="p-5 space-y-3">
          <div className="flex items-center gap-3">
            <UIAsset name="classes" className="h-11 w-11" />
            <div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Class display</h2><p className="text-sm text-ink/60">How this classroom is labeled for you and your learners.</p></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Grade Level</label>
              <input className="clay-input" value={classForm.grade_level} onChange={(e) => setClassForm({ ...classForm, grade_level: e.target.value })} />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Section</label>
              <input className="clay-input" value={classForm.section} onChange={(e) => setClassForm({ ...classForm, section: e.target.value })} />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Subject</label>
              <input className="clay-input" value={classForm.subject} onChange={(e) => setClassForm({ ...classForm, subject: e.target.value })} />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">School Year</label>
              <input className="clay-input" value={classForm.school_year} onChange={(e) => setClassForm({ ...classForm, school_year: e.target.value })} />
            </div>
          </div>
          <ClassDaySelector value={classForm.class_days} onChange={(class_days) => setClassForm({ ...classForm, class_days })} />
          <ClayButton color="sky" size="sm" onClick={saveClass} disabled={saving === "class"}>
            {saving === "class" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save Class Details</>}
          </ClayButton>
        </ClayCard>
      )}

      {tab === "weights" && (
        <ClayCard className="p-5 space-y-3">
          <div className="flex items-center gap-3"><UIAsset name="analytics" className="h-11 w-11" /><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Grading weights</h2><p className="text-sm text-ink/60">Balance each assessment category to reach 100%.</p></div></div>
          <div className="grid grid-cols-2 gap-3">
            {WEIGHT_KEYS.map((w) => (
              <div key={w.key}>
                <label className="font-display font-bold text-xs mb-1 block">{w.label} (%)</label>
                <input type="number" min="0" max="100" className="clay-input font-mono" value={weights[w.key]} onChange={(e) => setWeights({ ...weights, [w.key]: Number(e.target.value) })} />
              </div>
            ))}
          </div>
          <p className={`text-xs font-display font-bold ${weightSum === 100 ? "text-clay-lime" : "text-clay-coral"}`}>Total: {weightSum}% {weightSum === 100 && <Check className="w-3 h-3 inline" />}</p>
          <ClayButton color="lime" size="sm" onClick={saveWeights} disabled={saving === "weights"}>
            {saving === "weights" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save Weights</>}
          </ClayButton>
        </ClayCard>
      )}

      {tab === "code" && (
        <>
          <ClayCard color="purple" className="p-5 text-center">
            <p className="text-white/80 font-display font-bold text-sm mb-1">CURRENT CLASS CODE</p>
            <p className="text-3xl font-mono font-bold tracking-widest text-white">{classroom.join_code}</p>
            <ClayButton color="sky" size="sm" className="mt-3" onClick={copyJoinCode}><Copy className="w-4 h-4" /> Copy Code</ClayButton>
            <ClayButton color="pink" size="sm" className="mt-3" onClick={resetCode} disabled={saving === "code"}>
              {saving === "code" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RefreshCw className="w-4 h-4" /> Reset Code</>}
            </ClayButton>
          </ClayCard>
          <ClayCard className="p-5 space-y-3">
            <h2 className="font-display font-bold text-sm">Academic Year</h2>
            <input className="clay-input" value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2026-2027" />
            <ClayButton color="sky" size="sm" onClick={saveYear} disabled={saving === "year"}>
              {saving === "year" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save Year</>}
            </ClayButton>
          </ClayCard>
        </>
      )}

      {tab === "terms" && (
        <>
          <ClayCard className="p-5">
            <h2 className="font-display font-bold text-sm mb-3">New Term</h2>
            <form onSubmit={createTerm} className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="font-display font-bold text-xs mb-1 block">Label</label>
                <input className="clay-input" value={termForm.term_label} onChange={(e) => setTermForm({ ...termForm, term_label: e.target.value })} required />
              </div>
              <div>
                <label className="font-display font-bold text-xs mb-1 block">Start</label>
                <input type="date" className="clay-input" value={termForm.start_date} onChange={(e) => setTermForm({ ...termForm, start_date: e.target.value })} required />
              </div>
              <div>
                <label className="font-display font-bold text-xs mb-1 block">End</label>
                <input type="date" className="clay-input" value={termForm.end_date} onChange={(e) => setTermForm({ ...termForm, end_date: e.target.value })} required />
              </div>
              <div className="sm:col-span-3">
                <ClayButton type="submit" color="purple" size="md" disabled={saving === "term"}>
                  {saving === "term" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Term & Set Active"}
                </ClayButton>
              </div>
            </form>
          </ClayCard>
          {terms.length === 0 ? (
            <p className="text-ink/50 text-sm text-center">No terms yet. Create your first grading term above.</p>
          ) : (
            <div className="space-y-3">
              {terms.map((t) => (
                <ClayCard key={t.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-display font-bold">{t.term_label}</p>
                        {t.is_active && <ClayChip color="lime"><Check className="w-3 h-3" /> Active</ClayChip>}
                      </div>
                      <p className="text-xs text-ink/60 font-mono mt-0.5">{t.start_date} → {t.end_date}</p>
                    </div>
                    <div className="flex gap-2">
                      {!t.is_active && <ClayButton size="sm" color="lime" onClick={() => setActiveTerm(t)}>Set Active</ClayButton>}
                      <button onClick={() => removeTerm(t.id)} className="clay-btn bg-clay-coral text-white px-2 py-2"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </ClayCard>
              ))}
            </div>
          )}
        </>
      )}
        </div>
      </div>
    </div>
  );
}
