import { useEffect, useMemo, useState } from "react";

import ClayCard from "@/components/ClayCard";
import ClayButton from "@/components/ClayButton";
import ClayChip from "@/components/ClayChip";
import DragDropMatch from "@/components/student/DragDropMatch";
import { Loader2, RotateCcw } from "lucide-react";
import { getMissionSubmissionReview, startMissionRetry, submitMission } from '@/lib/secureActions';
import { formatMissionDeadline, isMissionLocked } from '@/lib/missionProgress';

function displayAnswer(question, value, type) {
  if (value === undefined || value === null) return "No answer";
  if (type === 'true_false') return value ? 'True' : 'False';
  return question?.options?.[Number(value)] ?? String(value);
}

// ai_content is a text column, but RPC payloads can hand back an already-parsed
// object. Accept either instead of blanking the mission when the shape drifts.
function parseAiContent(raw) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

export default function MissionAssessment({ mission, group, existing, onDone }) {
  const content = parseAiContent(mission.ai_content);
  const originalQuestions = useMemo(() => Array.isArray(content.questions) ? content.questions : [], [mission.ai_content]);
  const [questions, setQuestions] = useState(originalQuestions);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryAttemptId, setRetryAttemptId] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [review, setReview] = useState(null);
  const [result, setResult] = useState(() => existing ? { ...existing } : null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => { setQuestions(originalQuestions); setQuestionIndex(0); setShowReview(false); }, [originalQuestions]);
  useEffect(() => {
    if (!result) return;
    let live = true;
    getMissionSubmissionReview(mission.id, group.id, retryAttemptId).then((data) => { if (live) setReview(data); }).catch(() => { if (live) setReview(null); });
    return () => { live = false; };
  }, [result, mission.id, mission.formative_type, group.id, retryAttemptId]);

  if (!mission.ai_content) return <ClayCard className="p-4"><p className="text-ink/50 text-sm">Mission content unavailable.</p></ClayCard>;
  if (!existing && isMissionLocked(mission)) return <ClayCard className="p-4"><p className="font-display font-bold text-clay-coral">Mission locked</p><p className="mt-1 text-xs text-ink/60">The deadline was {formatMissionDeadline(mission)}. New answers are no longer accepted.</p></ClayCard>;
  if (mission.formative_type !== "drag_drop" && questions.length === 0) return <ClayCard className="p-4"><p className="text-ink/50 text-sm">This mission has no questions available yet. Ask your teacher to regenerate it.</p></ClayCard>;
  const formativeBrief = (content.learning_target || content.student_instructions || content.estimated_minutes) ? (
    <div className="rounded-xl border-2 border-ink/15 bg-clay-sky/15 p-3 text-sm space-y-1">
      {content.learning_target && <p><span className="font-display font-bold">Your learning target:</span> {content.learning_target}</p>}
      {content.student_instructions && <p><span className="font-display font-bold">Directions:</span> {content.student_instructions}</p>}
      {content.estimated_minutes && <p className="text-xs text-ink/60">Plan for about {content.estimated_minutes} minute{content.estimated_minutes === 1 ? "" : "s"}.</p>}
    </div>
  ) : null;

  async function submit(submittedAnswers) {
    setSubmitting(true); setSubmitError("");
    try {
      const submission = await submitMission({ p_mission_id: mission.id, p_group_id: group.id, p_score: 0, p_answers: JSON.stringify(submittedAnswers), p_retry_attempt_id: retryAttemptId });
      setResult({ ...submission }); onDone();
    } catch (err) { setSubmitError(err?.message || "Your answers could not be submitted. Please try again."); }
    finally { setSubmitting(false); }
  }

  async function beginRetry() {
    setRetrying(true); setSubmitError("");
    try {
      const retry = await startMissionRetry(mission.id, group.id);
      setQuestions(retry.questions || []); setRetryAttemptId(retry.attemptId); setAnswers({}); setReview(null); setResult(null); setQuestionIndex(0); setShowReview(false);
    } catch (err) { setSubmitError(err?.message || "A fresh retry could not be started."); }
    finally { setRetrying(false); }
  }

  if (result) {
    const displayMax = mission.formative_type === 'drag_drop' ? (content.left || []).length : questions.length;
    const reviewedScore = review?.score ?? result.score;
    const reviewedMax = review?.maxScore ?? displayMax;
    return <ClayCard className="p-4 space-y-4">
      <div className="text-center"><div className="text-4xl mb-2">{reviewedScore >= reviewedMax * 0.8 ? "🎉" : reviewedScore >= reviewedMax * 0.5 ? "🙂" : "😢"}</div><p className="font-display font-bold text-lg">{retryAttemptId ? `Retry result: ${reviewedScore}/${reviewedMax}` : `${reviewedScore}/${reviewedMax}`}</p><ClayChip color="sun">{result.xp_earned ?? Math.round((reviewedScore / reviewedMax) * mission.xp_reward)} XP earned</ClayChip>{retryAttemptId && <p className="mt-2 text-xs text-ink/60">This retry is for feedback and practice only. Your XP stays based on the first attempt.</p>}</div>
      {mission.formative_type !== 'drag_drop' && <div className="space-y-2"><p className="font-display font-bold text-sm">Answer review</p>{review?.items?.map((item) => {
        const question = questions[item.index];
        return <div key={item.index} className={`rounded-xl border-2 p-3 text-sm ${item.correct ? 'border-clay-lime bg-clay-lime/15' : 'border-clay-coral bg-clay-coral/10'}`}><p className="font-display font-bold">Question {item.index + 1} · {item.correct ? 'Correct' : 'Try again'}</p>{!item.correct && <p className="mt-1">Correct answer: <b>{displayAnswer(question, item.correct_answer, mission.formative_type)}</b></p>}<p className="mt-1 text-xs text-ink/70">Why: {item.explanation}</p></div>;
      })}</div>}
      {mission.formative_type === 'drag_drop' && <div className="space-y-2"><p className="font-display font-bold text-sm">Placement feedback</p>{review?.items?.map((item) => (
        <div key={item.item} className={`rounded-xl border-2 p-3 text-sm ${item.correct ? 'border-clay-lime bg-clay-lime/15' : 'border-clay-coral bg-clay-coral/10'}`}>
          <p className="font-display font-bold">{item.item} · {item.correct ? 'Correct placement' : 'Try again'}</p>
          <p className="mt-1 text-xs">Your category: <b>{item.selected || 'No category selected'}</b></p>
          {!item.correct && <p className="mt-1">Correct category: <b>{item.correct_answer}</b></p>}
          <p className="mt-1 text-xs text-ink/70">Why: {item.explanation}</p>
        </div>
      ))}</div>}
      {mission.formative_type !== 'drag_drop' && reviewedScore < reviewedMax && <ClayButton color="sky" size="sm" className="w-full" onClick={beginRetry} disabled={retrying}>{retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RotateCcw className="w-4 h-4" /> Try a fresh variant</>}</ClayButton>}
      {submitError && <p className="rounded-lg bg-clay-coral/15 border-2 border-clay-coral/40 p-3 text-xs font-bold text-clay-coral">{submitError}</p>}
    </ClayCard>;
  }

  if (mission.formative_type === "drag_drop") return <div className="space-y-3">{formativeBrief}<DragDropMatch left={content.left || []} right={content.right || []} answers={{}} onSubmit={(res) => submit(res.placements || {})} submitting={submitting} error={submitError} /></div>;

  const question = questions[questionIndex];
  const answeredCount = Object.keys(answers).length;
  const isLastQuestion = questionIndex === questions.length - 1;

  return <ClayCard className="p-4 space-y-4">
    {formativeBrief}
    <div className="flex items-center justify-between gap-3"><p className="font-display font-bold text-sm">{retryAttemptId ? 'Practice retry' : 'Score attempt'}</p><span className="text-xs font-mono text-ink/60">{answeredCount}/{questions.length} answered</span></div>
    <div className="h-2 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-clay-purple transition-all" style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div>
    {!showReview ? <>
      <div className="space-y-2"><p className="font-body text-sm">{questionIndex + 1}. {question.prompt}</p>
        {question.image_url && <img src={question.image_url} alt={`Visual for question ${questionIndex + 1}`} className="max-h-72 w-full rounded-xl border-2 border-ink bg-white object-contain" loading="lazy" />}
        {mission.formative_type === "true_false" ? <div className="flex gap-2">{[true, false].map((value) => <button key={String(value)} type="button" onClick={() => setAnswers({ ...answers, [questionIndex]: value })} className={`clay-btn px-4 py-2 text-sm ${answers[questionIndex] === value ? (value ? "bg-clay-lime text-ink" : "bg-clay-coral text-white") : "bg-cream text-ink/60"}`}>{value ? 'True' : 'False'}</button>)}</div> : <div className="grid grid-cols-2 gap-2">{question.options?.map((option, optionIndex) => <button key={optionIndex} type="button" onClick={() => setAnswers({ ...answers, [questionIndex]: optionIndex })} className={`clay-btn min-h-12 w-full justify-start px-3 py-2 text-left text-sm ${answers[questionIndex] === optionIndex ? "bg-clay-purple text-white" : "bg-cream text-ink"}`}>{option}</button>)}</div>}</div>
      <div className="flex gap-2"><ClayButton color="cream" size="sm" onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))} disabled={questionIndex === 0}>Back</ClayButton><ClayButton color="purple" size="sm" className="ml-auto" onClick={() => isLastQuestion ? setShowReview(true) : setQuestionIndex((index) => index + 1)} disabled={answers[questionIndex] === undefined}>{isLastQuestion ? 'Review answers' : 'Next question'}</ClayButton></div>
    </> : <div className="rounded-xl border-2 border-clay-purple/30 bg-clay-purple/10 p-3"><p className="font-display font-bold">Ready to submit?</p><p className="mt-1 text-xs text-ink/65">You answered all {questions.length} questions. Your score attempt is submitted once; feedback practice does not change XP.</p><div className="mt-3 flex gap-2"><ClayButton color="cream" size="sm" onClick={() => setShowReview(false)}>Check answers</ClayButton><ClayButton color="lime" size="sm" className="ml-auto" onClick={() => submit(answers)} disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit for secure grading'}</ClayButton></div></div>}
    {submitError && <p className="rounded-lg bg-clay-coral/15 border-2 border-clay-coral/40 p-3 text-xs font-bold text-clay-coral">{submitError}</p>}
  </ClayCard>;
}
