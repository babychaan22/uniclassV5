
import { useState } from "react";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import FillInTheBlank from "@/components/student/FillInTheBlank";
import DragDropMatch from "@/components/student/DragDropMatch";
import { Eye, CheckCircle2 } from "lucide-react";

// Read-only visual preview of AI-generated mission content for the teacher.
// Distinct from the student-facing instructions in MissionAssessment/DragDropMatch.
function WorkedGuide({ guide }) {
  const steps = Array.isArray(guide?.solution_steps)
    ? guide.solution_steps.map((step) => String(step || "").trim()).filter(Boolean)
    : [];
  const remember = String(guide?.remember || "").trim();
  return <div className="mt-2 rounded-lg border border-ink/10 bg-white/75 p-2 text-xs text-ink/80">
    <p className="font-display font-bold text-ink">Student review after submission</p>
    <ol className="mt-1 list-decimal space-y-1 pl-4 leading-relaxed">
      {steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
    </ol>
    {remember && <p className="mt-2 border-t border-ink/10 pt-2"><b>Remember:</b> {remember}</p>}
  </div>;
}

export default function MissionPreview({ type, content }) {
  const [previewAnswers, setPreviewAnswers] = useState({});
  if (!content) return null;
  const questions = content.questions || [];
  const answers = content.answers || {};

  return (
    <ClayCard className="p-4 bg-white/60">
      <p className="font-display font-bold text-xs mb-2 flex items-center gap-1"><Eye className="w-4 h-4" /> Visual preview (how students will see it)</p>
      {(content.learning_target || content.student_instructions || content.estimated_minutes) && (
        <div className="mb-3 rounded-xl border-2 border-ink/15 bg-clay-sky/15 p-3 text-xs space-y-1">
          {content.learning_target && <p><span className="font-display font-bold">Learning target:</span> {content.learning_target}</p>}
          {content.student_instructions && <p><span className="font-display font-bold">Directions:</span> {content.student_instructions}</p>}
          {content.estimated_minutes && <p className="text-ink/60">About {content.estimated_minutes} minute{content.estimated_minutes === 1 ? "" : "s"}</p>}
        </div>
      )}

      {type === "true_false" && (
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div key={i} className="rounded-xl border-2 border-ink/15 bg-cream p-2">
              <p className="font-body text-sm">{i + 1}. {q.prompt}</p>
              {q.image_url && <img src={q.image_url} alt={`Visual for question ${i + 1}`} className="mt-2 max-h-48 w-full rounded-lg border-2 border-ink bg-white object-contain" />}
              <div className="flex gap-2 mt-1">
                <ClayChip color={answers[i] === true ? "lime" : "cream"}>{answers[i] === true ? <><CheckCircle2 className="w-3 h-3" /> True</> : "True"}</ClayChip>
                <ClayChip color={answers[i] === false ? "coral" : "cream"}>{answers[i] === false ? <><CheckCircle2 className="w-3 h-3" /> False</> : "False"}</ClayChip>
              </div>
            </div>
          ))}
        </div>
      )}

      {type === "multiple_choice" && (
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div key={i} className="rounded-xl border-2 border-ink/15 bg-cream p-2">
              <p className="font-body text-sm">{i + 1}. {q.prompt}</p>
              {q.image_url && <img src={q.image_url} alt={`Visual for question ${i + 1}`} className="mt-2 max-h-48 w-full rounded-lg border-2 border-ink bg-white object-contain" />}
              <div className="grid sm:grid-cols-2 gap-1 mt-1">
                {(q.options || []).map((opt, oi) => (
                  <span key={oi} className={`clay-chip px-2 py-1 text-xs ${Number(answers[i]) === oi ? "bg-clay-lime text-ink" : "bg-white text-ink/70"}`}>
                    {Number(answers[i]) === oi && <CheckCircle2 className="w-3 h-3" />} {opt}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {type === "drag_drop" && (
        <DragDropMatch left={content.left} right={content.right} answers={answers} preview />
      )}

      {type === "fill_in_blank" && (
        <FillInTheBlank questions={questions} answers={previewAnswers} onChange={setPreviewAnswers} preview />
      )}

      <details className="mt-4 rounded-xl border-2 border-clay-purple/25 bg-clay-purple/10 p-3">
        <summary className="cursor-pointer font-display text-sm font-bold text-ink">Teacher review: answer key and learning feedback</summary>
        <p className="mt-1 text-xs text-ink/65">Students see these worked steps only after they submit. Check that every answer and explanation is accurate before publishing.</p>
        <div className="mt-3 space-y-2">
          {(type === "true_false" || type === "multiple_choice") && questions.map((question, index) => {
            const correct = type === "true_false"
              ? (answers[index] ? "True" : "False")
              : (question.options || [])[Number(answers[index])] ?? "Missing answer";
            return <div key={index} className="rounded-lg border border-ink/10 bg-cream p-3 text-sm">
              <p className="font-display font-bold">Question {index + 1} · Correct answer: {correct}</p>
              <WorkedGuide guide={question} />
            </div>;
          })}
          {type === "drag_drop" && (content.left || []).map((item) => <div key={item} className="rounded-lg border border-ink/10 bg-cream p-3 text-sm">
            <p className="font-display font-bold">{item} · Correct category: {answers[item] || "Missing answer"}</p>
            <WorkedGuide guide={content.feedback?.[item]} />
          </div>)}
          {type === "fill_in_blank" && Object.entries(answers).map(([key, answer]) => {
            const question = questions[Number(key.split(":")[0])] || {};
            return <div key={key} className="rounded-lg border border-ink/10 bg-cream p-3 text-sm">
              <p className="font-display font-bold">Blank {key} · Correct answer: {String(answer)}</p>
              <WorkedGuide guide={question} />
            </div>;
          })}
        </div>
      </details>
    </ClayCard>
  );
}
