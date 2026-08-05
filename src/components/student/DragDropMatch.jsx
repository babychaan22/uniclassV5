
import { useState } from "react";
import ClayCard from "@/components/ClayCard";
import ClayButton from "@/components/ClayButton";
import { Check, X, Layers } from "lucide-react";

// Categorization drag-and-drop. Students drag item tiles into category panels;
// multiple items may belong to the same panel. `answers` maps item -> category.
export default function DragDropMatch({ left, right, answers, onSubmit }) {
  const [placed, setPlaced] = useState({});
  const [dragging, setDragging] = useState(null);

  const items = left || [];
  const categories = right || [];
  const unplaced = items.filter((it) => !placed[it]);
  const byCategory = (cat) => items.filter((it) => placed[it] === cat);

  function drop(cat) {
    if (!dragging) return;
    setPlaced((p) => ({ ...p, [dragging]: cat }));
    setDragging(null);
  }
  function remove(it) {
    setPlaced((p) => { const n = { ...p }; delete n[it]; return n; });
  }
  function submit() {
    let correct = 0;
    for (const it of items) { if (answers[it] && placed[it] === answers[it]) correct++; }
    onSubmit({ correct, total: items.length, score: correct, maxScore: items.length, placements: placed });
  }

  return (
    <ClayCard className="p-4 space-y-4">
      <p className="font-display font-bold text-sm flex items-center gap-2"><Layers className="w-4 h-4" /> Drag each tile into the correct category panel.</p>

      {unplaced.length > 0 && (
        <div>
          <p className="text-[11px] font-display font-bold text-ink/50 mb-1">TILES</p>
          <div className="flex flex-wrap gap-2">
            {unplaced.map((it) => (
              <span
                key={it}
                draggable
                onDragStart={() => setDragging(it)}
                onDragEnd={() => setDragging(null)}
                className="clay-chip px-3 py-2 text-sm bg-clay-purple text-white cursor-grab active:cursor-grabbing select-none"
              >
                {it}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {categories.map((cat) => (
          <div
            key={cat}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(cat)}
            className={`rounded-xl border-[3px] border-dashed p-3 min-h-[96px] transition-colors ${dragging ? "border-clay-purple bg-clay-purple/10" : "border-ink/25 bg-cream"}`}
          >
            <p className="font-display font-bold text-sm mb-2">{cat}</p>
            <div className="flex flex-wrap gap-2">
              {byCategory(cat).map((it) => (
                <span key={it} className="clay-chip px-2 py-1 text-xs bg-clay-pink text-white">
                  {it}
                  <button type="button" onClick={() => remove(it)} className="ml-1"><X className="w-3 h-3" /></button>
                </span>
              ))}
              {byCategory(cat).length === 0 && <span className="text-[10px] text-ink/40">Drop tiles here</span>}
            </div>
          </div>
        ))}
      </div>

      <ClayButton color="lime" size="md" className="w-full" onClick={submit} disabled={Object.keys(placed).length < items.length}>
        <Check className="w-4 h-4" /> Submit
      </ClayButton>
    </ClayCard>
  );
}

