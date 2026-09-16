
import { useState } from "react";

import ClayCard from "@/components/ClayCard";
import ClayButton from "@/components/ClayButton";
import ClayChip from "@/components/ClayChip";
import DragDropMatch from "@/components/student/DragDropMatch";
import { Loader2 } from "lucide-react";
import { submitMission } from '@/lib/secureActions';
import { invokeLLM } from '@/lib/aiService';

export default function MissionAssessment({ mission, group, userId, existing, onDone }) {
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function withTimeout(promise, ms = 25000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("AI grading timed out")), ms)),
    ]);
  }
  const [result, setResult] = useState(() => {
    if (!existing) return null;
    let parsed = {};
    try { parsed = JSON.parse(existing.answers || "{}"); } catch {}
    return { ...existing, answers: parsed, maxScore: existing.maxScore || mission.max_score };
  });

  if (!mission.ai_content) {
    return <ClayCard className="p-4"><p className="text-ink/50 text-sm">Mission content unavailable.</p></ClayCard>;
  }

  let content;
  try { content = JSON.parse(mission.ai_content); } catch { content = {}; }
  let answerKey = {};
  try { answerKey = JSON.parse(mission.answer_key || "{}"); } catch { answerKey = {}; }
  const questions = Array.isArray(content.questions) ? content.questions : [];

  if (mission.formative_type !== "drag_drop" && questions.length === 0) {
    return <ClayCard className="p-4"><p className="text-ink/50 text-sm">This mission has no questions available yet. Ask your teacher to regenerate it.</p></ClayCard>;
  }

  if (result) {
    const displayMax = result.maxScore || mission.max_score;
    const reviewItems = mission.formative_type === "drag_drop"
      ? []
      : (content.questions || []).map((q, i) => ({
        prompt: q.prompt,
        correct: String(result.answers?.[i]) === String(answerKey[i]),
      }));
    return (
      <ClayCard className="p-4">
        <div className="text-center">
        <div className="text-4xl mb-2">{result.score >= displayMax * 0.8 ? "🎉" : result.score >= displayMax * 0.5 ? "🙂" : "😢"}</div>
        <p className="font-display font-bold text-lg">{result.score}/{displayMax}</p>
        <ClayChip color="sun">{Math.round((result.score / displayMax) * mission.xp_reward)} XP</ClayChip>
        {result.feedback && <p className="mt-3 text-xs text-ink/70">{result.feedback}</p>}
        </div>
        {reviewItems.length > 0 && (
          <div className="mt-4 border-t-2 border-ink/15 pt-3 text-left space-y-2">
            <p className="text-xs font-display font-bold">Quick review</p>
            {reviewItems.map((item, i) => <div key={i} className={`rounded-lg px-3 py-2 text-xs ${item.correct ? "bg-clay-lime/20" : "bg-clay-coral/15"}`}><span className="font-mono font-bold mr-2">{item.correct ? "✓" : "Review"}</span>{item.prompt}</div>)}
          </div>
        )}
      </ClayCard>
    );
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError("");
    let score = 0;
    if (mission.formative_type === "true_false") {
      questions.forEach((q, i) => { if (answers[i] === answerKey[i]) score++; });
    } else if (mission.formative_type === "multiple_choice") {
      questions.forEach((q, i) => { if (Number(answers[i]) === Number(answerKey[i])) score++; });
    }
    const maxScore = questions.length || mission.max_score;

    try {
      // AI reviews every attempt, including completely incorrect answers.
      // The secure RPC remains the source of truth for the persisted score.
      const gradingPrompt = `Grade this student's formative assessment. Return JSON only: {"feedback": string, "items": [{"index": number, "correct": boolean, "explanation": string}]}. Do not refuse because answers are wrong.
Assessment type: ${mission.formative_type}
Questions: ${JSON.stringify(questions.map((q) => ({ prompt: q.prompt, options: q.options })))}
Correct answers: ${JSON.stringify(answerKey)}
Student answers: ${JSON.stringify(answers)}`;
      let aiFeedback = "";
      try {
        const aiGrade = await withTimeout(invokeLLM({ prompt: gradingPrompt }));
        aiFeedback = aiGrade?.feedback || "AI grading complete.";
      } catch (aiError) {
        // Never lose a student's attempt because the AI provider is busy.
        aiFeedback = "AI feedback is temporarily unavailable, but your answers were graded.";
        console.warn("AI grading unavailable; saving deterministic grade", aiError);
      }
      await submitMission({
        p_mission_id: mission.id,
        p_group_id: group.id,
        p_score: score,
        p_answers: JSON.stringify(answers),
      });
      setResult({ score, maxScore, answers, feedback: aiFeedback });
      onDone();
    } catch (err) {
      console.error(err);
      setSubmitError(err?.message || "Your answers could not be submitted. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (mission.formative_type === "drag_drop") {
    return (
      <DragDropMatch
        left={content.left || []}
        right={content.right || []}
        answers={answerKey}
        onSubmit={async (res) => {
          setSubmitting(true);
          setSubmitError("");
          let aiFeedback = "";
          try {
            const aiGrade = await withTimeout(invokeLLM({ prompt: `Grade this drag-and-drop assessment. Return JSON only: {"feedback": string}. Do not refuse because answers are wrong.
Items and correct categories: ${JSON.stringify(answerKey)}
Student placements: ${JSON.stringify(res.placements || {})}` }));
            aiFeedback = aiGrade?.feedback || "AI grading complete.";
          } catch (aiError) {
            aiFeedback = "AI feedback is temporarily unavailable, but your answers were graded.";
            console.warn("AI grading unavailable; saving deterministic grade", aiError);
          }
          try {
            await submitMission({
              p_mission_id: mission.id,
              p_group_id: group.id,
              p_score: res.score,
              p_answers: JSON.stringify(res.placements || {}),
            });
            setResult({ ...res, answers: res.placements || {}, feedback: aiFeedback });
            onDone();
          } catch (err) {
            setSubmitError(err?.message || "Your answers could not be submitted. Please try again.");
          } finally {
            setSubmitting(false);
          }
        }}
        submitting={submitting}
        error={submitError}
      />
    );
  }

  return (
    <ClayCard className="p-4 space-y-4">
      <p className="font-display font-bold text-sm">Answer the questions below:</p>
      {questions.map((q, i) => (
        <div key={i} className="space-y-2">
          <p className="font-body text-sm">{i + 1}. {q.prompt}</p>
          {mission.formative_type === "true_false" ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => setAnswers({ ...answers, [i]: true })}
                className={`clay-btn px-4 py-2 text-sm ${answers[i] === true ? "bg-clay-lime text-ink" : "bg-cream text-ink/60"}`}>
                True
              </button>
              <button type="button" onClick={() => setAnswers({ ...answers, [i]: false })}
                className={`clay-btn px-4 py-2 text-sm ${answers[i] === false ? "bg-clay-coral text-white" : "bg-cream text-ink/60"}`}>
                False
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {q.options?.map((opt, oi) => (
                <button key={oi} type="button" onClick={() => setAnswers({ ...answers, [i]: oi })}
                  className={`clay-btn w-full justify-start px-4 py-2 text-sm ${answers[i] === oi ? "bg-clay-purple text-white" : "bg-cream text-ink"}`}>
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {submitError && <p className="rounded-lg bg-clay-coral/15 border-2 border-clay-coral/40 p-3 text-xs font-bold text-clay-coral">{submitError}</p>}
      <ClayButton color="lime" size="md" className="w-full" onClick={submit} disabled={submitting || Object.keys(answers).length < questions.length}>
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit for AI Grading"}
      </ClayButton>
    </ClayCard>
  );
}
