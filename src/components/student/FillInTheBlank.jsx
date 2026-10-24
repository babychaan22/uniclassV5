import { useMemo, useState } from "react";
import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import { Check, GripVertical, X } from "lucide-react";

function blankId(token) {
  return token.slice(2, -2).trim();
}

function questionBlanks(question, questionIndex) {
  return Array.from(String(question.prompt || "").matchAll(/\{\{([^}]+)\}\}/g)).map((match) => ({
    id: match[1].trim(),
    key: `${questionIndex}:${match[1].trim()}`,
  }));
}

// Designed tap-first for phones: choose an answer tile, then tap a blank.
// Dragging is an optional shortcut on devices that support it.
export default function FillInTheBlank({ questions, answers, onChange, onSubmit, submitting, error, preview = false }) {
  const [selectedWord, setSelectedWord] = useState(null);
  const blanks = useMemo(() => questions.flatMap((question, index) => questionBlanks(question, index)), [questions]);
  const usedWords = Object.values(answers || {});
  const remainingWords = questions.flatMap((question) => question.word_bank || []).filter((word) => !usedWords.includes(word) || word === selectedWord);

  function place(blankKey, word = selectedWord) {
    if (!word) return;
    const next = { ...(answers || {}) };
    Object.keys(next).forEach((key) => { if (next[key] === word) delete next[key]; });
    next[blankKey] = word;
    onChange(next);
    setSelectedWord(null);
  }

  function clear(blankKey) {
    const word = answers?.[blankKey];
    const next = { ...(answers || {}) };
    delete next[blankKey];
    onChange(next);
    setSelectedWord(word || null);
  }

  return (
    <ClayCard className="space-y-4 p-4">
      <div>
        <p className="font-display text-sm font-bold">Fill in every blank</p>
        <p className="mt-1 text-xs text-ink/60">Tap an answer from the box, then tap the blank where it belongs. You can also drag an answer into a blank.</p>
      </div>

      <div className="rounded-2xl border-2 border-clay-purple/25 bg-clay-purple/10 p-3">
        <p className="mb-2 text-[11px] font-display font-bold uppercase tracking-wide text-ink/55">Answer box</p>
        <div className="flex flex-wrap gap-2">
          {remainingWords.map((word, index) => (
            <button
              key={`${word}-${index}`}
              type="button"
              draggable
              aria-pressed={selectedWord === word}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", word)}
              onClick={() => setSelectedWord(selectedWord === word ? null : word)}
              className={`clay-chip touch-manipulation px-3 py-2 text-sm transition ${selectedWord === word ? "scale-105 bg-clay-purple text-white ring-4 ring-clay-sun" : "bg-white text-ink hover:-translate-y-0.5"}`}
            >
              <GripVertical className="h-3.5 w-3.5" /> {word}
            </button>
          ))}
          {remainingWords.length === 0 && <p className="text-xs text-ink/55">All answers are placed. Check each sentence, then submit.</p>}
        </div>
      </div>

      <div className="space-y-4">
        {questions.map((question, questionIndex) => {
          const pieces = String(question.prompt || "").split(/(\{\{[^}]+\}\})/g);
          return <div key={questionIndex} className="rounded-2xl border-2 border-ink/10 bg-cream p-3">
            <p className="mb-2 text-[11px] font-display font-bold text-ink/55">Sentence {questionIndex + 1}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm leading-7">
              {pieces.map((piece, index) => {
                if (!/^\{\{[^}]+\}\}$/.test(piece)) return <span key={`${piece}-${index}`}>{piece}</span>;
                const id = blankId(piece);
                const key = `${questionIndex}:${id}`;
                const value = answers?.[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => value ? clear(key) : place(key)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => { event.preventDefault(); place(key, event.dataTransfer.getData("text/plain")); }}
                    aria-label={value ? `Remove ${value} from blank` : `Fill blank ${id}`}
                    className={`inline-flex min-h-9 min-w-24 items-center justify-center rounded-xl border-2 px-2 text-sm font-display font-bold transition ${value ? "border-clay-purple bg-clay-purple text-white" : selectedWord ? "border-dashed border-clay-purple bg-white text-clay-purple" : "border-dashed border-ink/30 bg-white text-ink/45"}`}
                  >
                    {value ? <>{value}<X className="ml-1 h-3.5 w-3.5" /></> : "Tap to fill"}
                  </button>
                );
              })}
            </p>
          </div>;
        })}
      </div>

      {error && <p className="rounded-lg border-2 border-clay-coral/40 bg-clay-coral/15 p-3 text-xs font-bold text-clay-coral">{error}</p>}
      {preview
        ? <p className="rounded-xl border-2 border-clay-sky/40 bg-clay-sky/10 p-3 text-xs font-display font-bold text-ink/70">Interactive preview — student answers are not submitted from this screen.</p>
        : <ClayButton color="lime" size="md" className="w-full" onClick={() => onSubmit(answers)} disabled={submitting || blanks.some((blank) => !answers?.[blank.key])}>
            {submitting ? "Grading…" : <><Check className="h-4 w-4" /> Submit answers</>}
          </ClayButton>}
    </ClayCard>
  );
}
