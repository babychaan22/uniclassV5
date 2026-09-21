
import { useState } from "react";
import ClayCard from "@/components/ClayCard";
import ClayButton from "@/components/ClayButton";
import { Check, X, Layers } from "lucide-react";

// Categorization activity without a drag gesture. Students tap a tile, then a
// category, which is more reliable on phones and gives instant visual feedback.
export default function DragDropMatch({ left, right, answers, onSubmit, submitting = false, error = "" }) {
  const [placed, setPlaced] = useState({});
  const [selectedItem, setSelectedItem] = useState(null);

  const items = left || [];
  const categories = right || [];
  const unplaced = items.filter((it) => !placed[it]);
  const byCategory = (cat) => items.filter((it) => placed[it] === cat);

  function assignSelected(category) {
    if (!selectedItem) return;
    setPlaced((current) => ({ ...current, [selectedItem]: category }));
    setSelectedItem(null);
  }
  function remove(item) {
    setPlaced((current) => { const next = { ...current }; delete next[item]; return next; });
    setSelectedItem(item);
  }
  function submit() {
    let correct = 0;
    for (const it of items) { if (answers[it] && placed[it] === answers[it]) correct++; }
    onSubmit({ correct, total: items.length, score: correct, maxScore: items.length, placements: placed });
  }

  return (
    <ClayCard className="p-4 space-y-4">
      <p className="font-display font-bold text-sm flex items-center gap-2"><Layers className="w-4 h-4" /> Tap a tile, then tap its correct category.</p>

      {unplaced.length > 0 && (
        <div>
          <p className="text-[11px] font-display font-bold text-ink/50 mb-1">TILES</p>
          <div className="flex flex-wrap gap-2">
            {unplaced.map((it) => {
              const selected = selectedItem === it;
              return <button key={it} type="button" aria-pressed={selected} onClick={() => setSelectedItem(selected ? null : it)} className={`clay-chip px-3 py-2 text-sm bg-clay-purple text-white touch-manipulation transition-all duration-150 ${selected ? "ring-4 ring-clay-sun scale-105 -translate-y-1 shadow-lg" : "hover:-translate-y-0.5 active:scale-95"}`}>{it}</button>;
            })}
          </div>
          {!selectedItem && <p className="mt-2 text-[11px] text-ink/50">Choose one tile to start.</p>}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {categories.map((cat) => (
          <div
            key={cat}
            role="button"
            tabIndex={selectedItem ? 0 : -1}
            onClick={() => assignSelected(cat)}
            onKeyDown={(event) => { if (selectedItem && (event.key === "Enter" || event.key === " ")) assignSelected(cat); }}
            className={`rounded-xl border-[3px] border-dashed p-3 min-h-[96px] text-left transition-all duration-150 ${selectedItem ? "cursor-pointer border-clay-purple bg-clay-purple/10 hover:-translate-y-0.5 hover:shadow-md active:scale-[.98]" : "border-ink/25 bg-cream"}`}
          >
            <p className="font-display font-bold text-sm mb-2">{cat}</p>
            <div className="flex flex-wrap gap-2">
              {byCategory(cat).map((it) => (
                <span key={it} className="clay-chip px-2 py-1 text-xs bg-clay-pink text-white inline-flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                  {it}
                  <span role="button" tabIndex={0} aria-label={`Remove ${it} from ${cat}`} onClick={() => remove(it)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") remove(it); }} className="rounded p-0.5 hover:bg-white/20"><X className="w-3 h-3" /></span>
                </span>
              ))}
              {byCategory(cat).length === 0 && <span className="text-[10px] text-ink/40">{selectedItem ? "Tap to place the selected tile" : "Select a tile first"}</span>}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="rounded-lg bg-clay-coral/15 border-2 border-clay-coral/40 p-3 text-xs font-bold text-clay-coral">{error}</p>}
      <ClayButton color="lime" size="md" className="w-full" onClick={submit} disabled={submitting || Object.keys(placed).length < items.length}>
        {submitting ? <><span className="inline-block w-4 h-4 border-2 border-ink border-t-transparent rounded-full animate-spin" /> Grading…</> : <><Check className="w-4 h-4" /> Submit</>}
      </ClayButton>
    </ClayCard>
  );
}
