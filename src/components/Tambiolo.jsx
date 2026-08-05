
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { GACHA_OUTCOMES, playTick, playChime } from "@/lib/gacha";
import MascotWidget from "@/components/MascotWidget";

const COLORS = ["#FF6B57", "#FFD93D", "#A6E22E", "#4FD1F2", "#8B5CF6", "#FF5FA8", "#FF9F1C", "#5EE2C4"];
const K = 28;
const SIZE = 280;
const R = 118;
const BALL_R = 17;

function rand(seed) {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}

export default function Tambiolo({ targetIndex, soundOn, onDone }) {
  const [settled, setSettled] = useState(false);
  const tickRef = useRef(null);

  const balls = GACHA_OUTCOMES.map((o, bi) => {
    const ang = (bi / GACHA_OUTCOMES.length) * Math.PI * 2;
    const bx = Math.cos(ang) * (R - BALL_R - 10);
    const by = Math.sin(ang) * (R - BALL_R - 10);
    const xs = [], ys = [], times = [];
    for (let i = 0; i < K; i++) {
      const t = i / (K - 1);
      const env = Math.sin(Math.PI * t);
      xs.push(bx + (rand(bi * 13 + i) - 0.5) * 72 * env);
      ys.push(by + (rand(bi * 7 + i + 99) - 0.5) * 72 * env);
      times.push(t);
    }
    if (bi === targetIndex) { xs[K - 1] = 0; ys[K - 1] = 0; xs[K - 2] = 0; ys[K - 2] = 0; }
    return { o, color: COLORS[bi % COLORS.length], xs, ys, times };
  });

  useEffect(() => {
    if (!soundOn) return;
    let cancelled = false;
    const start = Date.now();
    function schedule() {
      if (cancelled) return;
      const elapsed = (Date.now() - start) / 4000;
      if (elapsed >= 1) return;
      playTick();
      const env = Math.sin(Math.PI * elapsed);
      const delay = 260 - 200 * env;
      tickRef.current = setTimeout(schedule, delay);
    }
    schedule();
    return () => { cancelled = true; if (tickRef.current) clearTimeout(tickRef.current); };
  }, [soundOn]);

  function handleComplete() {
    setSettled(true);
    if (soundOn) playChime(GACHA_OUTCOMES[targetIndex]?.mood);
    setTimeout(onDone, 900);
  }

  return (
    <div className="flex flex-col items-center">
      <div className="mb-2 flex items-center gap-2"><MascotWidget state="gacha" size="sm" /><span className="font-display text-sm font-extrabold">Nova&apos;s capsule machine</span></div>
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <div className="absolute inset-0 rounded-full border-[5px] border-ink bg-clay-purple shadow-[6px_6px_0_#17162B] overflow-hidden" />
        <div className="absolute inset-3 rounded-full border-2 border-white/15" />
        {balls.map((b, i) => (
          <motion.div
            key={i}
            initial={{ x: b.xs[0], y: b.ys[0] }}
            animate={{ x: b.xs, y: b.ys }}
            transition={{ duration: 4, times: b.times, ease: "linear" }}
            onAnimationComplete={i === 0 ? handleComplete : undefined}
            className="absolute top-1/2 left-1/2"
            style={{ marginLeft: -BALL_R, marginTop: -BALL_R }}
          >
            <div
              className={cn(
                "rounded-full border-[3px] border-ink flex items-center justify-center font-display font-extrabold transition-transform duration-300",
                settled && i === targetIndex ? "scale-150 ring-4 ring-clay-sun z-10" : ""
              )}
              style={{ width: BALL_R * 2, height: BALL_R * 2, background: b.color, fontSize: 11 }}
            >
              {b.o.mult}×
            </div>
          </motion.div>
        ))}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 clay-chip bg-clay-sun text-ink px-3 text-[10px]">TAMBIOLO</div>
      </div>
      <p className="font-display font-bold text-sm text-ink/60 mt-5 h-5">
        {settled ? GACHA_OUTCOMES[targetIndex]?.label : "Tumbling..."}
      </p>
    </div>
  );
}
