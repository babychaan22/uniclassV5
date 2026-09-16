import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, Star } from "lucide-react";
import { GACHA_OUTCOMES, playChime, playTick } from "@/lib/gacha";
import MascotWidget from "@/components/MascotWidget";

const REEL_VALUES = GACHA_OUTCOMES.map((outcome) => `${outcome.mult}×`);

export default function Tambiolo({ targetIndex = 1, soundOn, onDone }) {
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [reels, setReels] = useState([1, 1, 1]);
  const timerRef = useRef(null);
  const tickRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
  }, []);

  function pullLever() {
    if (started) return;
    setStarted(true);
    setFinished(false);
    let ticks = 0;
    tickRef.current = setInterval(() => {
      ticks += 1;
      setReels([0, 1, 2].map((index) => (ticks + index * 2 + Math.floor(Math.random() * 2)) % REEL_VALUES.length));
      if (soundOn) playTick();
    }, 95);

    timerRef.current = setTimeout(() => {
      clearInterval(tickRef.current);
      setReels([targetIndex, targetIndex, targetIndex]);
      setFinished(true);
      if (soundOn) playChime(GACHA_OUTCOMES[targetIndex]?.mood);
      setTimeout(onDone, 900);
    }, 3000);
  }

  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 flex items-center gap-2"><MascotWidget state="gacha" size="sm" /><span className="font-display text-sm font-extrabold">Nova&apos;s points spinner</span></div>
      <div className="relative w-full max-w-[330px] pt-5 pb-8">
        <div className="relative rounded-[32px] border-[5px] border-ink bg-[#F9BA35] px-5 pt-7 shadow-[7px_8px_0_#17162B]">
          <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-ink bg-clay-coral px-6 py-2 text-white shadow-[3px_3px_0_#17162B]"><div className="flex gap-3"><Star className="h-5 w-5 fill-white" /><Star className="h-5 w-5 fill-white" /><Star className="h-5 w-5 fill-white" /></div></div>
          <div className="rounded-2xl border-4 border-ink bg-[#FFF9EF] p-3 shadow-inner"><div className="grid grid-cols-3 gap-2">
            {reels.map((value, index) => <div key={index} className="relative flex h-24 items-center justify-center overflow-hidden rounded-xl border-4 border-ink bg-white shadow-[inset_0_-8px_0_#E6E8F0]"><motion.div key={`${started}-${finished}-${index}-${value}`} initial={started && !finished ? { y: -18 } : { y: 0 }} animate={{ y: 0 }} transition={{ duration: finished ? 0.35 : 0.08, ease: "linear" }} className="font-mono text-4xl font-black text-ink">{REEL_VALUES[value]}</motion.div></div>)}
          </div></div>
          <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[#D98B2B]/40 px-3 py-2 text-center text-xs font-bold text-ink">{finished ? "Your multiplier is ready!" : started ? "Rolling the numbers…" : "Pull the lever to try your luck"}</div>
          <div className="mx-auto mt-4 h-3 w-2/3 rounded-full border-2 border-ink bg-[#8B3C32]" />
        </div>
        <button type="button" aria-label={started ? "Spinner is rolling" : "Pull lever to spin"} onClick={pullLever} disabled={started} className={`absolute -right-1 top-16 flex h-28 w-12 flex-col items-center justify-end rounded-r-2xl border-y-4 border-r-4 border-ink pb-2 transition-transform ${started ? "bg-clay-sun" : "bg-[#F9BA35] hover:-translate-y-1"}`}>
          <span className={`absolute -top-5 h-10 w-10 rounded-full border-4 border-ink bg-clay-coral shadow-[2px_2px_0_#17162B] ${started ? "scale-90" : ""}`} /><span className="h-16 w-3 rounded-full border-2 border-ink bg-[#F9BA35]" />{!started && <Play className="absolute bottom-2 h-3 w-3 fill-ink" />}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[10px] font-bold text-ink/70">{GACHA_OUTCOMES.map((outcome) => <span key={outcome.mult}>{outcome.mult}×</span>)}</div>
    </div>
  );
}
