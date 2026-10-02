
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getTeacherClassrooms, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Loader2, Sparkles, Upload, X, Pencil, Check, RotateCcw } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { setMissionApproval, approvePowerUpForAllClasses, updateMission } from "@/lib/secureActions";
import MissionPreview from "@/components/teacher/MissionPreview";
import MissionAnswerReview from "@/components/teacher/MissionAnswerReview";
import { ROUTES } from '@/lib/routes';
import { invokeLLM } from "@/lib/aiService";
import NovaEmptyState from "@/components/mascot/NovaEmptyState";
import NovaMessage from "@/components/NovaMessage";
import { NovaAsset, UIAsset } from "@/components/visual/UIAsset";
import { formatMissionDeadline, getMissionProgress } from '@/lib/missionProgress';

const PROMPT_TEMPLATES = {
  true_false: {
    placeholder: "e.g. Water-cycle changes of state",
    template: "Check one focused learning target with 5 clear true/false statements.",
  },
  multiple_choice: {
    placeholder: "e.g. Plotting ordered pairs on a coordinate plane",
    template: "Check one focused learning target with 5 four-option questions.",
  },
  drag_drop: {
    placeholder: "e.g. Classify angles as acute, right, obtuse, or straight",
    template: "Check one focused learning target with a meaningful sorting task.",
  },
};

function missionPreviewContent(m) {
  let c = {}; try { c = JSON.parse(m.ai_content || "{}"); } catch {}
  let ak = {}; try { ak = JSON.parse(m.answer_key || "{}"); } catch {}
  return { ...c, answers: ak.answers || ak };
}

function questionStats(mission, submissions) {
  if (!mission?.ai_content || !mission?.answer_key) return [];
  let content; let answers;
  try { content = JSON.parse(mission.ai_content); answers = JSON.parse(mission.answer_key); answers = answers.answers || answers; } catch { return []; }
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
  const [members, setMembers] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", xp_reward: 100, max_score: 10, deadline: "", deadline_time: "23:59", formative_type: "manual", content: "", learning_target: "", assessment_purpose: "quick_check", student_instructions: "", prior_knowledge: "" });
  const [creating, setCreating] = useState(false);
  const [aiContent, setAiContent] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [draftKey] = useState(() => crypto.randomUUID());
  const [grading, setGrading] = useState(null);
  const [gradeVal, setGradeVal] = useState("");
  const [savingGrade, setSavingGrade] = useState(false);
  const [viewTemplateId, setViewTemplateId] = useState(null);
  const [targetAllClasses, setTargetAllClasses] = useState(true);
  const [targetClassIds, setTargetClassIds] = useState([]);
  const [targetStatuses, setTargetStatuses] = useState(["On Track", "Developing", "At Risk"]);
  const [reviewingId, setReviewingId] = useState(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [reviewMsg, setReviewMsg] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

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
      getClassroomDataset(c.id, ['groups','members','submissions']),
      db.entities.Mission.filter({ created_by: user.id }),
      getTeacherClassrooms(user.id),
    ]);
    setMissions([...catalog].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")));
    setGroups([...ds.groups].sort((a, b) => a.group_number - b.group_number));
    setMembers(ds.members);
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
      description: isAi ? (aiContent?.student_instructions || form.student_instructions || form.content) : form.description,
      xp_reward: Number(form.xp_reward),
      max_score: Number(form.max_score),
      deadline: form.deadline || undefined,
      deadline_at: form.deadline ? new Date(`${form.deadline}T${form.deadline_time || '23:59'}:00+08:00`).toISOString() : undefined,
      is_active: false,
      created_by: user.id,
      applies_to_all_classes: targetAllClasses,
      target_classroom_ids: targetAllClasses ? [] : targetClassIds,
      target_statuses: targetStatuses,
      formative_type: form.formative_type,
      ai_content: isAi && aiContent
        ? JSON.stringify({
          learning_target: aiContent.learning_target || form.learning_target,
          student_instructions: aiContent.student_instructions || form.student_instructions,
          assessment_purpose: aiContent.assessment_purpose || form.assessment_purpose,
          estimated_minutes: aiContent.estimated_minutes,
          ...(form.formative_type === "drag_drop" ? { left: aiContent.left, right: aiContent.right, feedback: aiContent.feedback || {} } : { questions: aiContent.questions }),
        })
        : undefined,
      answer_key: isAi && aiContent ? JSON.stringify({ answers: aiContent.answers, retry_variants: aiContent.retry_variants || [] }) : undefined,
    });
    setForm({ title: "", description: "", xp_reward: 100, max_score: 10, deadline: "", deadline_time: "23:59", formative_type: "manual", content: "", learning_target: "", assessment_purpose: "quick_check", student_instructions: "", prior_knowledge: "" });
    setAiContent(null);
    setGenMsg(null);
    setTargetAllClasses(true);
    setTargetClassIds([classroom.id]);
    setTargetStatuses(["On Track", "Developing", "At Risk"]);
    setCreating(false);
    invalidateClassroomDataset();
    load();
  }

  function updateQuestion(index, patch) {
    setAiContent((current) => {
      if (!current?.questions) return current;
      return { ...current, questions: current.questions.map((question, i) => i === index ? { ...question, ...patch } : question) };
    });
  }

  async function uploadQuestionImage(file, index) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) { setGenMsg("Use a JPG, PNG, or WebP image for a question visual."); return; }
    if (file.size > 5 * 1024 * 1024) { setGenMsg("Keep uploaded question visuals under 5 MB."); return; }
    setGeneratingImage(true); setGenMsg(null);
    try {
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${user.id}/${draftKey}/question-${index + 1}-${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("mission-images").upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("mission-images").getPublicUrl(path);
      updateQuestion(index, { image_url: data.publicUrl });
      setGenMsg(`Visual added to question ${index + 1}.`);
    } catch (err) { setGenMsg("Image upload failed: " + (err.message || "error")); }
    setGeneratingImage(false);
  }

  async function generateAI(e) {
    e.preventDefault();
    if (!form.title || !form.content || !form.learning_target) { setGenMsg("Add a title, topic, and learning target first."); return; }
    setGenerating(true);
    setGenMsg(null);
    const type = form.formative_type;
    const purposeLabels = { diagnostic: "diagnostic check before instruction", quick_check: "quick formative check during or after instruction", reteach: "reteaching check for a previously difficult skill", exit_ticket: "brief end-of-lesson exit ticket" };
    const prompt = `You are an expert classroom assessment designer. Create a student-ready, targeted formative assessment.\nTitle: ${form.title}\nSubject topic: ${form.content}\nRequired learning target: ${form.learning_target}\nAssessment purpose: ${purposeLabels[form.assessment_purpose] || form.assessment_purpose}\nLearner directions supplied by teacher: ${form.student_instructions || "Write clear, encouraging directions."}\nPrior knowledge or misconception to check: ${form.prior_knowledge || "Not specified"}\nFormat: ${type}\n\nRequirements:\n- Assess ONLY the stated learning target; do not add unrelated facts or advanced skills.\n- Use age-appropriate, plain language that students can read independently.\n- Produce exactly 5 items unless the format makes fewer items necessary.\n- Each item must be answerable from the prompt and any attached visual alone. Do not reveal answers in the item wording or directions.\n- Include plausible distractors that reflect common misconceptions, but never trick learners.\n- Include a one-sentence explanation for each correct answer so students receive useful feedback after submitting.\n- For Mathematics, make values and correct answers exactly verifiable.\n- Return valid JSON only.\n\nTop-level JSON required for every format: {"learning_target":string,"student_instructions":string,"assessment_purpose":string,"estimated_minutes":number,...}. The learning_target must be learner-friendly and begin with "I can...". Student instructions must be 1-2 short sentences and must not give answers.\n- For "true_false": add {"questions":[{"prompt":string,"explanation":string}],"answers":[boolean],"retry_variants":[{"questions":[{"prompt":string,"explanation":string}],"answers":[boolean]}]}. The retry variant must assess the same target with fresh facts or values.\n- For "multiple_choice": add {"questions":[{"prompt":string,"options":[4 strings],"explanation":string}],"answers":[number],"retry_variants":[{"questions":[{"prompt":string,"options":[4 strings],"explanation":string}],"answers":[number]}]}. Each answer is the zero-based index. The retry variant must assess the same target with fresh facts or values.\n- For "drag_drop": add {"left":[strings],"right":[strings],"answers":{"item":"category"}}. Use meaningful categories and enough items to demonstrate the target.`;
    const promptWithDragFeedback = type === "drag_drop"
      ? prompt.replace('"answers":{"item":"category"}}. Use meaningful', '"answers":{"item":"category"},"feedback":{"item":"one short sentence explaining why the item belongs in its category"}}. Use meaningful')
      : prompt;
    try {
      const res = await invokeLLM({ prompt: promptWithDragFeedback });
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

  // Approving publishes a mission to students; rejecting withholds it. The
  // switch above is deliberately not a shortcut for this: is_active alone must
  // not be able to skip the review.
  async function reviewMission(m, status) {
    setReviewingId(m.id);
    setReviewMsg(null);
    try {
      await setMissionApproval(m.id, status);
      await invalidateClassroomDataset();
      await load();
    } catch (err) {
      setReviewMsg(`Could not ${status === 'approved' ? 'approve' : 'withhold'} that mission: ${err.message || 'error'}`);
    } finally {
      setReviewingId(null);
    }
  }

  // One Power-Up row is generated per classroom, so approving them one at a
  // time would mean the same decision repeated for every class. This publishes
  // today's Power-Up to all of the teacher's Mathematics classes at once.
  async function approveAllPowerUps() {
    setApprovingAll(true);
    setReviewMsg(null);
    try {
      const res = await approvePowerUpForAllClasses();
      setReviewMsg(res?.message || 'Power-Ups approved.');
      await invalidateClassroomDataset();
      await load();
    } catch (err) {
      setReviewMsg('Could not approve the Power-Ups: ' + (err.message || 'error'));
    } finally {
      setApprovingAll(false);
    }
  }

  // A published mission is still the teacher's to correct. Editing it must not
  // withdraw it from students, so the RPC leaves approval and visibility alone.
  function startEdit(m) {
    setEditingId(m.id);
    setReviewMsg(null);
    setEditForm({
      title: m.title || '',
      description: m.description || '',
      xp_reward: String(m.xp_reward ?? ''),
      max_score: String(m.max_score ?? ''),
      deadline: m.deadline || '',
    });
  }

  async function saveEdit(m) {
    setSavingEdit(true);
    setReviewMsg(null);
    try {
      const patch = {
        title: editForm.title,
        description: editForm.description,
        xp_reward: Number(editForm.xp_reward),
        max_score: Number(editForm.max_score),
        deadline: editForm.deadline || null,
      };
      await updateMission(m.id, patch);
      setEditingId(null);
      setEditForm(null);
      await invalidateClassroomDataset();
      await load();
    } catch (err) {
      setReviewMsg('Could not save your changes: ' + (err.message || 'error'));
    } finally {
      setSavingEdit(false);
    }
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

  // Anything the teacher has not reviewed yet. A Power-Up is generated every
  // morning and lands here first; students see nothing until it is approved.
  const pendingPowerUps = missions.filter((m) => (m.approval_status || 'pending') !== 'approved');

  return (
    <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(310px,.7fr)] lg:items-center">
        <div><p className="text-sm font-semibold text-[var(--uc-purple)]">Formative assessment</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Create a mission</h1><p className="mt-1 text-sm leading-relaxed text-ink/60">Design a focused assessment, attach question visuals when they help, then target the learners who need it.</p></div>
        <NovaMessage variant="assessment" tone="violet" title="Great questions create brighter learning.">Nova can help you prepare a student-ready formative check.</NovaMessage>
      </section>

      <ClayCard className="p-5">
        <div className="mb-4 flex items-center gap-3"><UIAsset name="assessment" className="h-12 w-12" /><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Mission details</h2><p className="text-sm text-ink/60">Start with the learning target students should practice.</p></div></div>
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
                <label className="font-display font-bold text-xs mb-1 block">Lesson topic or content</label>
                <textarea className="clay-input" rows={2} placeholder={PROMPT_TEMPLATES[form.formative_type]?.placeholder || "e.g. Match countries to their capitals"} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
                <p className="text-[10px] text-ink/50 mt-1">Prompt template: {PROMPT_TEMPLATES[form.formative_type]?.template}</p>
              </div>
              <div>
                <label className="font-display font-bold text-xs mb-1 block">Learning target students should reach</label>
                <input className="clay-input" placeholder="e.g. I can plot and identify ordered pairs on a coordinate plane." value={form.learning_target} onChange={(e) => setForm({ ...form, learning_target: e.target.value })} required />
                <p className="text-[10px] text-ink/50 mt-1">Use one observable skill. This is shown to students before they start.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-display font-bold text-xs mb-1 block">Assessment purpose</label>
                  <select className="clay-input" value={form.assessment_purpose} onChange={(e) => setForm({ ...form, assessment_purpose: e.target.value })}>
                    <option value="diagnostic">Diagnostic check</option>
                    <option value="quick_check">Quick check</option>
                    <option value="reteach">Reteaching check</option>
                    <option value="exit_ticket">Exit ticket</option>
                  </select>
                </div>
                <div>
                  <label className="font-display font-bold text-xs mb-1 block">Skill gap to check (optional)</label>
                  <input className="clay-input" placeholder="e.g. Confuses x- and y-coordinates" value={form.prior_knowledge} onChange={(e) => setForm({ ...form, prior_knowledge: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="font-display font-bold text-xs mb-1 block">Student directions (optional)</label>
                <textarea className="clay-input" rows={2} placeholder="e.g. Read each question carefully, choose your best answer, then submit for feedback." value={form.student_instructions} onChange={(e) => setForm({ ...form, student_instructions: e.target.value })} />
              </div>
              <ClayButton type="button" color="sky" size="sm" className="w-full" disabled={generating} onClick={generateAI}>
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4" /> Generate with AI</>}
              </ClayButton>
              <div className="flex items-center gap-3 rounded-2xl border border-[rgba(50,169,237,.14)] bg-[var(--uc-blue-soft)] p-3"><NovaAsset pose={generating ? "thinking" : "ai"} className="h-12 w-12 shrink-0" /><p className="text-xs font-display font-bold">{generating ? "Professor Nova is crafting your challenge…" : "Professor Nova turns your topic into a ready-to-review challenge."}</p></div>
              {genMsg && <p className={`text-xs font-display font-bold ${genMsg.includes("failed") || genMsg.includes("Add") ? "text-clay-coral" : "text-clay-lime"}`}>{genMsg}</p>}
              {aiContent && (
                <div className="space-y-3">
                  <MissionPreview type={form.formative_type} content={aiContent} />
                  {form.formative_type !== "drag_drop" && (
                    <div className="rounded-xl border-2 border-ink bg-clay-sun/15 p-3 space-y-3">
                      <div>
                        <p className="font-display font-bold text-sm">Question visuals</p>
                        <p className="text-xs text-ink/60">Add a diagram, photo, map, or other visual only where it helps students understand that question.</p>
                      </div>
                      {aiContent.questions?.map((question, index) => (
                        <div key={index} className="rounded-xl border-2 border-ink/20 bg-cream p-3 space-y-2">
                          <p className="text-sm font-body"><span className="font-display font-bold">Question {index + 1}.</span> {question.prompt}</p>
                          {question.image_url ? (
                            <div className="relative overflow-hidden rounded-lg border-2 border-ink bg-white">
                              <img src={question.image_url} alt={`Question ${index + 1} visual`} className="max-h-56 w-full object-contain" />
                              <button type="button" onClick={() => updateQuestion(index, { image_url: undefined })} className="absolute right-2 top-2 clay-btn bg-clay-coral p-1.5 text-white" aria-label={`Remove visual from question ${index + 1}`}><X className="w-4 h-4" /></button>
                            </div>
                          ) : <p className="text-xs text-ink/50">No visual attached.</p>}
                          <div>
                            <label className={`clay-btn bg-clay-sky px-2 py-2 text-xs cursor-pointer ${generatingImage ? "pointer-events-none opacity-60" : ""}`}><Upload className="w-4 h-4" /> Upload visual<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { uploadQuestionImage(e.target.files?.[0], index); e.target.value = ""; }} /></label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          <div className="grid sm:grid-cols-4 gap-3">
            <div>
              <label className="font-display font-bold text-xs mb-1 block">XP Reward</label>
              <input type="number" min="0" className="clay-input font-mono" value={form.xp_reward} onChange={(e) => setForm({ ...form, xp_reward: e.target.value })} required />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Max Score</label>
              <input type="number" min="1" className="clay-input font-mono" value={form.max_score} onChange={(e) => setForm({ ...form, max_score: e.target.value })} required />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Deadline date</label>
              <input type="date" className="clay-input" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Deadline time</label>
              <input type="time" className="clay-input" value={form.deadline_time} disabled={!form.deadline} onChange={(e) => setForm({ ...form, deadline_time: e.target.value })} />
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

      {reviewMsg && (
        <p className="text-center font-display font-bold text-sm text-ink/70">{reviewMsg}</p>
      )}

      {pendingPowerUps.length > 0 && (
        <ClayCard color="sun" className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display font-bold">
                {pendingPowerUps.length} mission{pendingPowerUps.length === 1 ? '' : 's'} waiting for your review
              </p>
              <p className="text-xs text-ink/70 mt-0.5">Students cannot see these yet. Read them over, then approve to publish.</p>
            </div>
            {pendingPowerUps.some((m) => m.mission_source === 'daily_foundation') && (
              <ClayButton onClick={approveAllPowerUps} disabled={approvingAll} color="lime" size="sm">
                {approvingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Approve today's Power-Up for all my classes
              </ClayButton>
            )}
          </div>
        </ClayCard>
      )}

      {missions.length === 0 && (
        <NovaEmptyState
          variant="idea"
          title="No missions yet"
          description="Nova is ready when you are—create your first mission above."
        />
      )}

      {missions.map((m) => {
        const isAi = m.formative_type && m.formative_type !== "manual";
        const progress = getMissionProgress(m, submissions, groups, members);
        let aiParsed = null, akParsed = {};
        if (isAi) {
          try { aiParsed = JSON.parse(m.ai_content || "{}"); } catch {}
          try { akParsed = JSON.parse(m.answer_key || "{}"); akParsed = akParsed.answers || akParsed; } catch {}
        }
        const stats = isAi ? questionStats(m, submissions) : [];
        const hardest = [...stats].sort((a, b) => a.pct - b.pct).slice(0, 2);
        const approval = m.approval_status || 'pending';
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
                  {formatMissionDeadline(m) && <ClayChip color="sky">Due {formatMissionDeadline(m)}</ClayChip>}
                  {m.formative_type && m.formative_type !== "manual" && <ClayChip color="purple">{m.formative_type.replace("_", " ")}</ClayChip>}
                  <ClayChip color="sky">{progress.completed}/{progress.total} {progress.individual ? 'students' : 'groups'} done</ClayChip>
                  <ClayChip color="lime">{progress.completion}% complete</ClayChip>
                  <ClayChip color="pink">{progress.accuracy}% accurate</ClayChip>
                  <ClayChip color={approval === 'approved' ? (m.is_active ? "lime" : "cream") : (approval === 'rejected' ? "coral" : "sun")}>
                    {approval === 'approved' ? (m.is_active ? "Active" : "Closed") : (approval === 'rejected' ? "Withheld" : "Awaiting approval")}
                  </ClayChip>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                {approval === 'approved' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-display font-bold">Live</span>
                    <Switch checked={m.is_active} onCheckedChange={() => toggleActive(m)} />
                  </div>
                ) : (
                  <ClayButton
                    onClick={() => reviewMission(m, 'approved')}
                    disabled={reviewingId === m.id}
                    color="lime"
                    size="sm"
                  >
                    {reviewingId === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Approve
                  </ClayButton>
                )}
                <div className="flex items-center gap-1">
                  {editingId === m.id ? (
                    <>
                      <ClayButton onClick={() => saveEdit(m)} disabled={savingEdit} color="lime" size="sm">
                        {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Save
                      </ClayButton>
                      <button onClick={() => { setEditingId(null); setEditForm(null); }} className="clay-btn bg-cream px-2 py-2" title="Cancel edit"><X className="w-4 h-4" /></button>
                    </>
                  ) : (
                    <button onClick={() => startEdit(m)} className="clay-btn bg-clay-sky px-2 py-2" title="Edit this mission"><Pencil className="w-4 h-4" /></button>
                  )}
                  {approval !== 'approved' && (
                    <button onClick={() => reviewMission(m, approval === 'rejected' ? 'pending' : 'rejected')} disabled={reviewingId === m.id} className="clay-btn bg-clay-sun px-2 py-2" title={approval === 'rejected' ? 'Send back for review' : 'Withhold from students'}>
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => removeMission(m.id)} className="clay-btn bg-clay-coral text-white px-2 py-2"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
            {editingId === m.id && editForm && (
              <div className="mt-3 rounded-xl border-2 border-ink/15 bg-cream p-3">
                <p className="text-xs font-display font-bold">Edit mission</p>
                <p className="text-[11px] text-ink/60 mt-0.5">Saving keeps this mission exactly as visible to students right now.</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="text-xs font-semibold sm:col-span-2">Title
                    <input className="clay-input mt-1 w-full bg-cream px-2 py-1.5 text-sm" value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
                  </label>
                  <label className="text-xs font-semibold sm:col-span-2">Description
                    <textarea className="clay-input mt-1 w-full bg-cream px-2 py-1.5 text-sm" rows={2} value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
                  </label>
                  <label className="text-xs font-semibold">XP reward
                    <input type="number" min="0" className="clay-input mt-1 w-full bg-cream px-2 py-1.5 text-sm" value={editForm.xp_reward} onChange={(e) => setEditForm((f) => ({ ...f, xp_reward: e.target.value }))} />
                  </label>
                  <label className="text-xs font-semibold">Max score
                    <input type="number" min="1" className="clay-input mt-1 w-full bg-cream px-2 py-1.5 text-sm" value={editForm.max_score} onChange={(e) => setEditForm((f) => ({ ...f, max_score: e.target.value }))} />
                  </label>
                  <label className="text-xs font-semibold">Due date
                    <input type="date" className="clay-input mt-1 w-full bg-cream px-2 py-1.5 text-sm" value={editForm.deadline || ''} onChange={(e) => setEditForm((f) => ({ ...f, deadline: e.target.value }))} />
                  </label>
                </div>
              </div>
            )}
            {isAi && (
              <div className="mt-2">
                <button type="button" onClick={() => setViewTemplateId(viewTemplateId === m.id ? null : m.id)} className="clay-btn bg-clay-sky text-ink px-3 py-1.5 text-xs">
                  {viewTemplateId === m.id ? "Hide template" : "View template"}
                </button>
                {viewTemplateId === m.id && <div className="mt-2"><MissionPreview type={m.formative_type} content={missionPreviewContent(m)} /></div>}
                {stats.length > 0 && (
                  <div className="mt-3 rounded-xl border-2 border-ink/15 bg-clay-sky/20 p-3">
                    <p className="text-xs font-display font-bold">Learning signal</p>
                    <p className="text-[11px] text-ink/60 mt-0.5">Based on {stats[0].total} submitted learner response{stats[0].total === 1 ? "" : "s"}.</p>
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
              <p className="text-xs font-display font-bold">{progress.individual ? 'Student progress by group' : `Per-group status (XP = score/${m.max_score} × ${m.xp_reward})`}</p>
              {groups.map((g) => {
                if (progress.individual) {
                  const groupMembers = members.filter((member) => member.group_id === g.id);
                  const answeredIds = new Set(progress.submissions.filter((submission) => submission.group_id === g.id && submission.group_member_id).map((submission) => submission.group_member_id));
                  const answered = groupMembers.filter((member) => answeredIds.has(member.id));
                  const waiting = groupMembers.filter((member) => !answeredIds.has(member.id));
                  return <details key={g.id} className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-2">
                    <summary className="cursor-pointer list-none flex items-center gap-2"><span className="inline-flex items-center gap-1 font-display font-bold text-sm flex-1">Group {g.group_number} <GroupBadgeMarkers groupId={g.id} /></span><ClayChip color={answered.length === groupMembers.length && groupMembers.length ? 'lime' : 'sun'}>{answered.length}/{groupMembers.length} answered</ClayChip></summary>
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2"><div><p className="font-display font-bold text-clay-lime">Answered ({answered.length})</p><p className="text-ink/65">{answered.length ? answered.map((member) => `${member.last_name}, ${member.first_name}`).join(' · ') : 'None yet'}</p></div><div><p className="font-display font-bold text-clay-coral">Not answered ({waiting.length})</p><p className="text-ink/65">{waiting.length ? waiting.map((member) => `${member.last_name}, ${member.first_name}`).join(' · ') : 'Everyone has responded'}</p></div></div>
                  </details>;
                }
                const sub = submissions.find((s) => s.mission_id === m.id && s.group_id === g.id);
                const groupMembers = members.filter((member) => member.group_id === g.id);
                const groupSubmissions = submissions.filter((submission) => submission.mission_id === m.id && submission.group_id === g.id && submission.group_member_id);
                const isGradingThis = grading?.missionId === m.id && grading?.groupId === g.id;
                let subAnswers = null;
                if (isAi && sub?.answers) { try { subAnswers = JSON.parse(sub.answers); } catch {} }
                return (
                  <div key={g.id} className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 font-display font-bold text-sm w-24 shrink-0">Group {g.group_number} <GroupBadgeMarkers groupId={g.id} /></span>
                    {isAi ? (
                      <div className="flex flex-1 flex-wrap items-center gap-2"><ClayChip color={groupSubmissions.length === groupMembers.length && groupMembers.length ? "lime" : "sun"}>{groupSubmissions.length}/{groupMembers.length} submitted</ClayChip>{groupSubmissions.map((studentSubmission) => { const member = members.find((item) => item.id === studentSubmission.group_member_id); return <ClayChip key={studentSubmission.id} color="sky">{member ? `${member.first_name} ${member.last_name}` : "Student"}: {studentSubmission.score} → {studentSubmission.xp_earned} XP</ClayChip>; })}</div>
                    ) : isGradingThis ? (
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
