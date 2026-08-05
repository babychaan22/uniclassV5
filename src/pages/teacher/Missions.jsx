
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Switch } from "@/components/ui/switch";
import { Target, Plus, Trash2, Loader2, Sparkles } from "lucide-react";
import MissionPreview from "@/components/teacher/MissionPreview";
import MissionAnswerReview from "@/components/teacher/MissionAnswerReview";
import { ROUTES } from '@/lib/routes';
import { invokeLLM } from "@/lib/aiService";
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

export default function TeacherMissions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [missions, setMissions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", xp_reward: 100, max_score: 10, deadline: "", formative_type: "manual", content: "" });
  const [creating, setCreating] = useState(false);
  const [aiContent, setAiContent] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState(null);
  const [grading, setGrading] = useState(null);
  const [gradeVal, setGradeVal] = useState("");
  const [savingGrade, setSavingGrade] = useState(false);
  const [viewTemplateId, setViewTemplateId] = useState(null);

  useEffect(() => { load(); }, [user]);
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
    const ds = await getClassroomDataset(c.id);
    setMissions([...ds.missions].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")));
    setGroups([...ds.groups].sort((a, b) => a.group_number - b.group_number));
    setSubmissions(ds.submissions);
  }

  async function createMission(e) {
    e.preventDefault();
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
      formative_type: form.formative_type,
      ai_content: isAi && aiContent
        ? JSON.stringify(form.formative_type === "drag_drop" ? { left: aiContent.left, right: aiContent.right } : { questions: aiContent.questions })
        : undefined,
      answer_key: isAi && aiContent ? JSON.stringify(aiContent.answers) : undefined,
    });
    setForm({ title: "", description: "", xp_reward: 100, max_score: 10, deadline: "", formative_type: "manual", content: "" });
    setAiContent(null);
    setGenMsg(null);
    setCreating(false);
    invalidateClassroomDataset();
    load();
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
              <div className="flex items-center gap-3 rounded-xl border-2 border-ink bg-clay-sky/30 p-3"><MascotWidget state={generating ? "ai_thinking" : "quest"} size="sm" /><p className="text-xs font-display font-bold">{generating ? "Professor Nova is crafting your challenge…" : "Professor Nova turns your topic into a ready-to-review challenge."}</p></div>
              {genMsg && <p className={`text-xs font-display font-bold ${genMsg.includes("failed") || genMsg.includes("Add") ? "text-clay-coral" : "text-clay-lime"}`}>{genMsg}</p>}
              {aiContent && (
                <div className="space-y-2">
                  <MissionPreview type={form.formative_type} content={aiContent} />
                </div>
              )}
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
        return (
          <ClayCard key={m.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display font-bold">{m.title}</p>
                {m.description && <p className="text-xs text-ink/60 mt-0.5">{m.description}</p>}
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
