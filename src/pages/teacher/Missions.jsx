
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getTeacherClassrooms, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Switch } from "@/components/ui/switch";
import { Target, Plus, Trash2, Loader2, Sparkles } from "lucide-react";
import MissionPreview from "@/components/teacher/MissionPreview";
import MissionAnswerReview from "@/components/teacher/MissionAnswerReview";
import { ROUTES } from '@/lib/routes';
import { generateMissionImage, invokeLLM } from "@/lib/aiService";
import MascotWidget from "@/components/MascotWidget";

const PROMPT_TEMPLATES = {
  true_false: {
    placeholder: "e.g. Facts about the water cycle",
    template: "Write 5 true/false statements about {topic}. Mark each correct answer.",
  },
  multiple_choice: {
    placeholder: "e.g. Photosynthesis basics — 4 options each",
    template: "Write 5 multiple-choice questions (4 options each) about {topic}. Mark the correct option index.",
  },
  drag_drop: {
    placeholder: "e.g. Sort animals into Mammals / Reptiles / Birds (several per category)",
    template: "List category panels + item tiles about {topic}; several tiles may share a category.",
  },
};

function missionPreviewContent(m) {
  let c = {}; try { c = JSON.parse(m.ai_content || "{}"); } catch {}
  let ak = {}; try { ak = JSON.parse(m.answer_key || "{}"); } catch {}
  return { ...c, answers: ak };
}

function questionStats(mission, submissions) {
  if (!mission?.ai_content || !mission?.answer_key) return [];
  let content; let answers;
  try { content = JSON.parse(mission.ai_content); answers = JSON.parse(mission.answer_key); } catch { return []; }
  const rows = mission.formative_type === "drag_drop"
    ? Object.keys(answers || {}).map((key) => ({ prompt: key, correct: answers[key] }))
    : (content.questions || []).map((q, i) => ({ prompt: q.prompt, correct: answers[i] }));
  const attempts = submissions.filter((s) => s.mission_id === mission.id && s.answers);
  return rows.map((row, index) => {
    let correct = 0;
    attempts.forEach((submission) => {
      try {
        const given = JSON.parse(submission.answers);
        const value = mission.formative_type === "drag_drop" ? given[row.prompt] : given[index];
        if (String(value) === String(row.correct)) correct++;
      } catch {}
    });
    return { ...row, correct, total: attempts.length, pct: attempts.length ? Math.round((correct / attempts.length) * 100) : 0 };
  });
}

export default function TeacherMissions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [teacherClasses, setTeacherClasses] = useState([]);
  const [missions, setMissions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", xp_reward: 100, max_score: 10, deadline: "", formative_type: "manual", content: "" });
  const [creating, setCreating] = useState(false);
  const [aiContent, setAiContent] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState(null);
  const [missionImage, setMissionImage] = useState(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageGenerations, setImageGenerations] = useState(0);
  const [draftKey] = useState(() => crypto.randomUUID());
  const [grading, setGrading] = useState(null);
  const [gradeVal, setGradeVal] = useState("");
  const [savingGrade, setSavingGrade] = useState(false);
  const [viewTemplateId, setViewTemplateId] = useState(null);
  const [targetAllClasses, setTargetAllClasses] = useState(true);
  const [targetClassIds, setTargetClassIds] = useState([]);
  const [targetStatuses, setTargetStatuses] = useState(["On Track", "Developing", "At Risk"]);

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('uniclass-teacher-class-changed', refresh);
    return () => window.removeEventListener('uniclass-teacher-class-changed', refresh);
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const unsub = db.entities.MissionSubmission.subscribe(() => { invalidateClassroomDataset(); load(); });
    return unsub;
  }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    setClassroom(c);
    const [ds, catalog, classes] = await Promise.all([
      getClassroomDataset(c.id, ['groups','submissions']),
      db.entities.Mission.filter({ created_by: user.id }),
      getTeacherClassrooms(user.id),
    ]);
    setMissions([...catalog].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")));
    setGroups([...ds.groups].sort((a, b) => a.group_number - b.group_number));
    setSubmissions(ds.submissions);
    setTeacherClasses(classes);
    setTargetClassIds((current) => current.length ? current : [c.id]);
  }

  async function createMission(e) {
    e.preventDefault();
    if (!targetAllClasses && targetClassIds.length === 0) { setGenMsg('Select at least one class.'); return; }
    if (targetStatuses.length === 0) { setGenMsg('Select at least one student status.'); return; }
    setCreating(true);
    const isAi = form.formative_type !== "manual";
    await db.entities.Mission.create({
      classroom_id: classroom.id,
      title: form.title,
      description: isAi ? form.content : form.description,
      xp_reward: Number(form.xp_reward),
      max_score: Number(form.max_score),
      deadline: form.deadline || undefined,
      is_active: false,
      created_by: user.id,
      applies_to_all_classes: targetAllClasses,
      target_classroom_ids: targetAllClasses ? [] : targetClassIds,
      target_statuses: targetStatuses,
      image_url: missionImage || undefined,
      formative_type: form.formative_type,
      ai_content: isAi && aiContent
        ? JSON.stringify(form.formative_type === "drag_drop" ? { left: aiContent.left, right: aiContent.right } : { questions: aiContent.questions })
        : undefined,
      answer_key: isAi && aiContent ? JSON.stringify(aiContent.answers) : undefined,
    });
    setForm({ title: "", description: "", xp_reward: 100, max_score: 10, deadline: "", formative_type: "manual", content: "" });
    setAiContent(null);
    setMissionImage(null);
    setImageGenerations(0);
    setGenMsg(null);
    setTargetAllClasses(true);
    setTargetClassIds([classroom.id]);
    setTargetStatuses(["On Track", "Developing", "At Risk"]);
    setCreating(false);
    invalidateClassroomDataset();
    load();
  }

  async function generateImage() {
    if (!form.title || !form.content) { setGenMsg("Add a title and topic first."); return; }
    if (imageGenerations >= 3) { setGenMsg("This mission has reached its 3-image limit."); return; }
    setGeneratingImage(true); setGenMsg(null);
    try {
      const imageUrl = await generateMissionImage({
        draftKey,
        prompt: `Create a clear, age-appropriate educational illustration for a classroom mission titled "${form.title}" about ${form.content}. No words, labels, numbers, logos, or watermark. Use a friendly learning-app style.`,
      });
      setMissionImage(imageUrl);
      setImageGenerations((count) => count + 1);
      setGenMsg("Image generated. Review it before creating the mission.");
    } catch (err) { setGenMsg("Image generation failed: " + (err.message || "error")); }
    setGeneratingImage(false);
  }

  async function generateAI(e) {
    e.preventDefault();
    if (!form.title || !form.content) { setGenMsg("Add a title and topic first."); return; }
    setGenerating(true);
    setGenMsg(null);
    const type = form.formative_type;
    const prompt = `Create a short formative assessment (about 5 items).\nTitle: ${form.title}\nTopic/content: ${form.content}\nFormat: ${type}\nReturn JSON only.\n- For "true_false": {"questions":[{"prompt":string}], "answers":[boolean]} where answers[i] is the correct true/false for questions[i].\n- For "multiple_choice": {"questions":[{"prompt":string,"options":[4 strings]}], "answers":[number]} where answers[i] is the index of the correct option.\n- For "drag_drop": {"left":[strings: items to sort], "right":[strings: category panels], "answers":{"item":"category"}} where each left item is sorted into its correct right category; multiple items may share a category.`;
    try {
      const res = await invokeLLM({ prompt });
      setAiContent(res);
      setGenMsg("Generated! Review below, then create the mission.");
    } catch (err) {
      setGenMsg("AI generation failed: " + (err.message || "error"));
    }
    setGenerating(false);
  }

  async function toggleActive(m) {
    await db.entities.Mission.update(m.id, { is_active: !m.is_active });
    invalidateClassroomDataset();
    load();
  }

  async function removeMission(id) {
    await db.entities.Mission.delete(id);
    if (grading?.missionId === id) cancelGrade();
    invalidateClassroomDataset();
    load();
  }

  function startGrade(missionId, groupId, currentScore) {
    setGrading({ missionId, groupId });
    setGradeVal(currentScore != null ? String(currentScore) : "");
  }

  function cancelGrade() { setGrading(null); setGradeVal(""); }

  async function saveGrade(e, m, g) {
    e.preventDefault();
    const score = Number(gradeVal);
    if (gradeVal === "" || Number.isNaN(score)) { cancelGrade(); return; }
    setSavingGrade(true);
    const xp = Math.max(0, Math.round((score / m.max_score) * m.xp_reward));
    const existing = submissions.find((s) => s.mission_id === m.id && s.group_id === g.id);
    if (existing) {
      await db.entities.MissionSubmission.update(existing.id, { score, xp_earned: xp, graded_by: user.id });
    } else {
      await db.entities.MissionSubmission.create({
        mission_id: m.id, group_id: g.id, classroom_id: classroom.id, score, xp_earned: xp, graded_by: user.id,
      });
    }
    setSavingGrade(false);
    cancelGrade();
    invalidateClassroomDataset();
    load();
  }

  if (!classroom) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><Target className="w-6 h-6" /> Group Missions</h1>
        <p className="text-ink/60 text-sm">Create formative-assessment missions. Students earn XP and redeem it into participation points.</p>
      </div>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">New Mission</h2>
        <form onSubmit={createMission} className="space-y-3">
          <div>
            <label className="font-display font-bold text-xs mb-1 block">Title</label>
            <input className="clay-input" placeholder="e.g. Quick Check: Verb Tenses" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="font-display font-bold text-xs mb-1 block">Assessment Type</label>
            <select className="clay-input" value={form.formative_type} onChange={(e) => { setForm({ ...form, formative_type: e.target.value }); setAiContent(null); setGenMsg(null); }}>
              <option value="manual">Manual (teacher-graded)</option>
              <option value="true_false">True / False (AI)</option>
              <option value="multiple_choice">Multiple Choice (AI)</option>
              <option value="drag_drop">Drag &amp; Drop (AI)</option>
            </select>
          </div>
          {form.formative_type === "manual" ? (
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Description</label>
              <textarea className="clay-input" rows={2} placeholder="What students need to do" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          ) : (
            <>
              <div>
                <label className="font-display font-bold text-xs mb-1 block">Topic / Content</label>
                <textarea className="clay-input" rows={2} placeholder={PROMPT_TEMPLATES[form.formative_type]?.placeholder || "e.g. Match countries to their capitals"} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
                <p className="text-[10px] text-ink/50 mt-1">Prompt template: {PROMPT_TEMPLATES[form.formative_type]?.template}</p>
              </div>
              <ClayButton type="button" color="sky" size="sm" className="w-full" disabled={generating} onClick={generateAI}>
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4" /> Generate with AI</>}
              </ClayButton>
              <ClayButton type="button" color="lime" size="sm" className="w-full" disabled={generatingImage || imageGenerations >= 3} onClick={generateImage}>
                {generatingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4" /> Generate mission image ({imageGenerations}/3)</>}
              </ClayButton>
              <div className="flex items-center gap-3 rounded-xl border-2 border-ink bg-clay-sky/30 p-3"><MascotWidget state={generating ? "ai_thinking" : "quest"} size="sm" /><p className="text-xs font-display font-bold">{generating ? "Professor Nova is crafting your challenge…" : "Professor Nova turns your topic into a ready-to-review challenge."}</p></div>
              {genMsg && <p className={`text-xs font-display font-bold ${genMsg.includes("failed") || genMsg.includes("Add") ? "text-clay-coral" : "text-clay-lime"}`}>{genMsg}</p>}
              {aiContent && (
                <div className="space-y-2">
                  <MissionPreview type={form.formative_type} content={aiContent} />
                </div>
              )}
              {missionImage && <div className="rounded-xl border-2 border-ink overflow-hidden"><img src={missionImage} alt="Generated mission illustration" className="w-full max-h-64 object-cover" /></div>}
            </>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-display font-bold text-xs mb-1 block">XP Reward</label>
              <input type="number" min="0" className="clay-input font-mono" value={form.xp_reward} onChange={(e) => setForm({ ...form, xp_reward: e.target.value })} required />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Max Score</label>
              <input type="number" min="1" className="clay-input font-mono" value={form.max_score} onChange={(e) => setForm({ ...form, max_score: e.target.value })} required />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Deadline</label>
              <input type="date" className="clay-input" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </div>
          </div>
          <div className="rounded-xl border-2 border-ink bg-clay-sky/20 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <label className="font-display font-bold text-sm block">Class availability</label>
                <p className="text-xs text-ink/55">{targetAllClasses ? 'Available in every class you teach.' : 'Available only in the selected classes.'}</p>
              </div>
              <Switch checked={targetAllClasses} onCheckedChange={setTargetAllClasses} aria-label="Make mission available in all classes" />
            </div>
            {!targetAllClasses && (
              <div>
                <p className="font-display font-bold text-xs mb-2">Selected classes</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {teacherClasses.map((item) => {
                    const checked = targetClassIds.includes(item.id);
                    return <label key={item.id} className="flex items-center gap-2 rounded-lg border-2 border-ink bg-cream px-3 py-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={checked} onChange={() => setTargetClassIds((ids) => checked ? ids.filter((id) => id !== item.id) : [...ids, item.id])} />
                      <span>{item.grade_level} · {item.section}</span>
                    </label>;
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="rounded-xl border-2 border-ink bg-clay-sun/20 p-3">
            <label className="font-display font-bold text-sm block">Student status</label>
            <p className="text-xs text-ink/55 mb-2">Show this mission to all learners, or only the statuses you select.</p>
            <div className="flex flex-wrap gap-2">
              {["On Track", "Developing", "At Risk"].map((status) => {
                const selected = targetStatuses.includes(status);
                return <button type="button" key={status} onClick={() => setTargetStatuses((statuses) => selected ? statuses.filter((item) => item !== status) : [...statuses, status])} className={`clay-chip px-3 py-1 text-sm ${selected ? 'bg-clay-purple text-white' : 'bg-cream text-ink'}`}>{status}</button>;
              })}
            </div>
          </div>
          <ClayButton type="submit" color="purple" size="md" className="w-full" disabled={creating || (form.formative_type !== "manual" && !aiContent)}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Create Mission</>}
          </ClayButton>
        </form>
      </ClayCard>

      {missions.length === 0 && <div className="flex flex-col items-center gap-2 py-3 text-center"><MascotWidget state="quest" /><p className="text-ink/50 text-sm">Nova is ready when you are—create your first mission above.</p></div>}

      {missions.map((m) => {
        const gradedCount = groups.filter((g) => submissions.find((s) => s.mission_id === m.id && s.group_id === g.id)).length;
        const isAi = m.formative_type && m.formative_type !== "manual";
        let aiParsed = null, akParsed = {};
        if (isAi) {
          try { aiParsed = JSON.parse(m.ai_content || "{}"); } catch {}
          try { akParsed = JSON.parse(m.answer_key || "{}"); } catch {}
        }
        const stats = isAi ? questionStats(m, submissions) : [];
        const hardest = [...stats].sort((a, b) => a.pct - b.pct).slice(0, 2);
        return (
          <ClayCard key={m.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display font-bold">{m.title}</p>
                {m.description && <p className="text-xs text-ink/60 mt-0.5">{m.description}</p>}
                {m.image_url && <img src={m.image_url} alt={`${m.title} illustration`} className="mt-2 max-h-32 w-full rounded-xl border-2 border-ink object-cover" loading="lazy" />}
                <div className="flex flex-wrap gap-2 mt-2">
                  <ClayChip color="sun">+{m.xp_reward} XP</ClayChip>
                  <ClayChip color="purple">/{m.max_score} max</ClayChip>
                  {m.deadline && <ClayChip color="sky">Due {m.deadline}</ClayChip>}
                  {m.formative_type && m.formative_type !== "manual" && <ClayChip color="purple">{m.formative_type.replace("_", " ")}</ClayChip>}
                  <ClayChip color="sky">{gradedCount}/{groups.length} graded</ClayChip>
                  <ClayChip color={m.is_active ? "lime" : "cream"}>{m.is_active ? "Active" : "Hidden"}</ClayChip>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-display font-bold">{m.is_active ? "On" : "Off"}</span>
                  <Switch checked={m.is_active} onCheckedChange={() => toggleActive(m)} />
                </div>
                <button onClick={() => removeMission(m.id)} className="clay-btn bg-clay-coral text-white px-2 py-2"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            {isAi && (
              <div className="mt-2">
                <button type="button" onClick={() => setViewTemplateId(viewTemplateId === m.id ? null : m.id)} className="clay-btn bg-clay-sky text-ink px-3 py-1.5 text-xs">
                  {viewTemplateId === m.id ? "Hide template" : "View template"}
                </button>
                {viewTemplateId === m.id && <div className="mt-2"><MissionPreview type={m.formative_type} content={missionPreviewContent(m)} /></div>}
                {stats.length > 0 && (
                  <div className="mt-3 rounded-xl border-2 border-ink/15 bg-clay-sky/20 p-3">
                    <p className="text-xs font-display font-bold">Learning signal</p>
                    <p className="text-[11px] text-ink/60 mt-0.5">Based on {stats[0].total} submitted group response{stats[0].total === 1 ? "" : "s"}.</p>
                    <div className="mt-2 space-y-1.5">
                      {hardest.map((q, i) => (
                        <div key={`${q.prompt}-${i}`} className="flex items-center gap-2 text-xs">
                          <span className="w-9 font-mono font-bold">{q.pct}%</span>
                          <div className="h-2 flex-1 rounded-full bg-cream border border-ink/20 overflow-hidden"><div className={`h-full ${q.pct < 60 ? "bg-clay-coral" : q.pct < 80 ? "bg-clay-sun" : "bg-clay-lime"}`} style={{ width: `${q.pct}%` }} /></div>
                          <span className="truncate max-w-[12rem]" title={q.prompt}>{q.prompt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 border-t-2 border-ink/15 pt-3 space-y-2">
              <p className="text-xs font-display font-bold">Per-group status (XP = score/{m.max_score} × {m.xp_reward})</p>
              {groups.map((g) => {
                const sub = submissions.find((s) => s.mission_id === m.id && s.group_id === g.id);
                const isGradingThis = grading?.missionId === m.id && grading?.groupId === g.id;
                let subAnswers = null;
                if (isAi && sub?.answers) { try { subAnswers = JSON.parse(sub.answers); } catch {} }
                return (
                  <div key={g.id} className="flex items-center gap-2">
                    <span className="font-display font-bold text-sm w-24 shrink-0">Group {g.group_number}</span>
                    {isGradingThis ? (
                      <div className="flex-1 space-y-2">
                        {isAi && <MissionAnswerReview type={m.formative_type} content={aiParsed} answerKey={akParsed} groupAnswers={subAnswers} />}
                        <form onSubmit={(e) => saveGrade(e, m, g)} className="flex gap-2">
                          <input type="number" min="0" max={m.max_score} step="0.1" className="clay-input font-mono flex-1" placeholder="score" value={gradeVal} onChange={(e) => setGradeVal(e.target.value)} autoFocus />
                          <ClayButton type="submit" color="lime" size="sm" disabled={savingGrade}>{savingGrade ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</ClayButton>
                          <ClayButton type="button" color="cream" size="sm" onClick={cancelGrade}>✕</ClayButton>
                        </form>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        {sub ? <ClayChip color="lime">{`${sub.score}/${m.max_score} -> ${sub.xp_earned} XP`}</ClayChip> : <ClayChip color="sun">Pending</ClayChip>}
                        <ClayButton size="sm" color={sub ? "cream" : "purple"} onClick={() => startGrade(m.id, g.id, sub?.score)}>{sub ? "Re-grade" : "Grade"}</ClayButton>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ClayCard>
        );
      })}
    </div>
  );
}
