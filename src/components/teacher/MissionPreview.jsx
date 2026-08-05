
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Eye, CheckCircle2 } from "lucide-react";

// Read-only visual preview of AI-generated mission content for the teacher.
// Distinct from the student-facing instructions in MissionAssessment/DragDropMatch.
export default function MissionPreview({ type, content }) {
  if (!content) return null;
  const questions = content.questions || [];
  const answers = content.answers || {};

  return (
    <ClayCard className="p-4 bg-white/60">
      <p className="font-display font-bold text-xs mb-2 flex items-center gap-1"><Eye className="w-4 h-4" /> Visual preview (how students will see it)</p>

      {type === "true_false" && (
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div key={i} className="rounded-xl border-2 border-ink/15 bg-cream p-2">
              <p className="font-body text-sm">{i + 1}. {q.prompt}</p>
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
        <div>
          <p className="text-xs text-ink/60 mb-2">Students drag each item tile into the correct category panel.</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {(content.right || []).map((cat) => {
              const items = (content.left || []).filter((l) => answers[l] === cat);
              return (
                <div key={cat} className="rounded-xl border-2 border-ink/15 bg-cream p-2">
                  <p className="font-display font-bold text-xs mb-1">{cat}</p>
                  <div className="flex flex-wrap gap-1">
                    {items.map((it) => (
                      <span key={it} className="clay-chip px-2 py-1 text-xs bg-clay-purple text-white">{it}</span>
                    ))}
                    {items.length === 0 && <span className="text-[10px] text-ink/40">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ClayCard>
  );
}

