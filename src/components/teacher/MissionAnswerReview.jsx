
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Eye, Check, X } from "lucide-react";

function Verdict({ ok }) {
  return ok
    ? <ClayChip color="lime"><Check className="w-3 h-3" /> Correct</ClayChip>
    : <ClayChip color="coral"><X className="w-3 h-3" /> Wrong</ClayChip>;
}

// Read-only review of a group's submitted answers against the correct answer key,
// shown to the teacher while grading / re-grading so they can verify the score.
export default function MissionAnswerReview({ type, content, answerKey, groupAnswers }) {
  if (!content) return null;
  const ga = groupAnswers || {};
  const questions = content.questions || [];
  const items = content.left || [];

  return (
    <ClayCard className="p-4 bg-white/60 space-y-3">
      <p className="font-display font-bold text-xs flex items-center gap-1"><Eye className="w-4 h-4" /> Group answers — verify before saving</p>

      {type === "true_false" && (
        <div className="space-y-2">
          {questions.map((q, i) => {
            const correct = answerKey[i];
            const given = ga[i];
            const answered = given === true || given === false;
            const ok = answered && given === correct;
            return (
              <div key={i} className="rounded-xl border-2 border-ink/15 bg-cream p-2">
                <p className="font-body text-sm">{i + 1}. {q.prompt}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-xs">Group: <b>{answered ? String(given) : "—"}</b></span>
                  <span className="text-xs">Correct: <b>{String(correct)}</b></span>
                  {answered && <Verdict ok={ok} />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {type === "multiple_choice" && (
        <div className="space-y-2">
          {questions.map((q, i) => {
            const correctIdx = Number(answerKey[i]);
            const givenIdx = ga[i] != null ? Number(ga[i]) : null;
            const answered = givenIdx != null && !Number.isNaN(givenIdx);
            const ok = answered && givenIdx === correctIdx;
            return (
              <div key={i} className="rounded-xl border-2 border-ink/15 bg-cream p-2">
                <p className="font-body text-sm">{i + 1}. {q.prompt}</p>
                <div className="grid sm:grid-cols-2 gap-1 mt-1">
                  {(q.options || []).map((opt, oi) => {
                    const isCorrect = oi === correctIdx;
                    const isGiven = answered && oi === givenIdx;
                    return (
                      <span key={oi} className={`clay-chip px-2 py-1 text-xs ${isCorrect ? "bg-clay-lime text-ink" : isGiven ? "bg-clay-coral text-white" : "bg-white text-ink/70"}`}>
                        {isCorrect && <Check className="w-3 h-3" />}{isGiven && !isCorrect && <X className="w-3 h-3" />} {opt}
                      </span>
                    );
                  })}
                </div>
                {!answered && <p className="text-[10px] text-ink/40 mt-1">Not answered</p>}
                {answered && <div className="mt-1"><Verdict ok={ok} /></div>}
              </div>
            );
          })}
        </div>
      )}

      {type === "drag_drop" && (
        <div className="space-y-2">
          {items.map((it) => {
            const correctCat = answerKey[it];
            const givenCat = ga[it];
            const answered = !!givenCat;
            const ok = answered && givenCat === correctCat;
            return (
              <div key={it} className="rounded-xl border-2 border-ink/15 bg-cream p-2 flex flex-wrap items-center gap-2">
                <ClayChip color="purple">{it}</ClayChip>
                <span className="text-xs">Group placed: <b>{answered ? givenCat : "—"}</b></span>
                <span className="text-xs">Correct: <b>{correctCat || "—"}</b></span>
                {answered && <Verdict ok={ok} />}
              </div>
            );
          })}
        </div>
      )}
    </ClayCard>
  );
}

