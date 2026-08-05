
const db = globalThis.__B44_DB__;

import { useState } from "react";

import ClayCard from "@/components/ClayCard";
import ClayButton from "@/components/ClayButton";
import ClayChip from "@/components/ClayChip";
import DragDropMatch from "@/components/student/DragDropMatch";
import { Loader2 } from "lucide-react";

export default function MissionAssessment({ mission, group, userId, existing, onDone }) {
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(existing || null);

  if (!mission.ai_content) {
    return <ClayCard className="p-4"><p className="text-ink/50 text-sm">Mission content unavailable.</p></ClayCard>;
  }

  let content;
  try { content = JSON.parse(mission.ai_content); } catch { content = {}; }
  let answerKey = {};
  try { answerKey = JSON.parse(mission.answer_key || "{}"); } catch { answerKey = {}; }

  if (result) {
    return (
      <ClayCard className="p-4 text-center">
        <div className="text-4xl mb-2">{result.score >= result.maxScore * 0.8 ? "🎉" : result.score >= result.maxScore * 0.5 ? "🙂" : "😢"}</div>
        <p className="font-display font-bold text-lg">{result.score}/{result.maxScore}</p>
        <ClayChip color="sun">{Math.round((result.score / result.maxScore) * mission.xp_reward)} XP</ClayChip>
      </ClayCard>
    );
  }

  async function submit() {
    setSubmitting(true);
    let score = 0;
    if (mission.formative_type === "true_false") {
      content.questions.forEach((q, i) => { if (answers[i] === answerKey[i]) score++; });
    } else if (mission.formative_type === "multiple_choice") {
      content.questions.forEach((q, i) => { if (Number(answers[i]) === answerKey[i]) score++; });
    }
    const maxScore = content.questions?.length || mission.max_score;
    const xp = Math.max(0, Math.round((score / maxScore) * mission.xp_reward));

    try {
      const existing = await db.entities.MissionSubmission.filter({ mission_id: mission.id, group_id: group.id });
      const payload = { score, xp_earned: xp, graded_by: userId, answers: JSON.stringify(answers) };
      if (existing.length > 0) {
        await db.entities.MissionSubmission.update(existing[0].id, payload);
      } else {
        await db.entities.MissionSubmission.create({
          mission_id: mission.id, group_id: group.id, classroom_id: group.classroom_id, ...payload,
        });
      }
      setResult({ score, maxScore });
      onDone();
    } catch (err) {
      console.error(err);
    }
    setSubmitting(false);
  }

  if (mission.formative_type === "drag_drop") {
    return (
      <DragDropMatch
        left={content.left || []}
        right={content.right || []}
        answers={answerKey}
        onSubmit={(res) => {
          const xp = Math.max(0, Math.round((res.score / res.maxScore) * mission.xp_reward));
          db.entities.MissionSubmission.create({
            mission_id: mission.id, group_id: group.id, classroom_id: group.classroom_id,
            score: res.score, xp_earned: xp, graded_by: userId, answers: JSON.stringify(res.placements || {}),
          }).then(() => { setResult(res); onDone(); });
        }}
      />
    );
  }

  return (
    <ClayCard className="p-4 space-y-4">
      <p className="font-display font-bold text-sm">Answer the questions below:</p>
      {(content.questions || []).map((q, i) => (
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
      <ClayButton color="lime" size="md" className="w-full" onClick={submit} disabled={submitting || Object.keys(answers).length < (content.questions?.length || 0)}>
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit for AI Grading"}
      </ClayButton>
    </ClayCard>
  );
}

