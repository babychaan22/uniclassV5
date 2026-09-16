
export const GACHA_OUTCOMES = [
  { mult: 0.5, mood: "sad", label: "Try again next time!", emoji: "🙂" },
  { mult: 1, mood: "neutral", label: "Your points are safe!", emoji: "🛡️" },
  { mult: 1.5, mood: "happy", label: "You lucky duck!", emoji: "🦆" },
  { mult: 2, mood: "happy", label: "Jackpot! Wohoo!", emoji: "🎉" },
];

export const MOOD_COLOR = {
  sad: "coral",
  neutral: "sun",
  happy: "lime",
};

let audioCtx = null;
function getCtx() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return null;
    }
  }
  return audioCtx;
}

export function playTick() {
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 880;
  gain.gain.value = 0.04;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
  osc.stop(ctx.currentTime + 0.04);
}

export function playChime(mood) {
  const ctx = getCtx();
  if (!ctx) return;
  const notes = mood === "happy" ? [523, 659, 784, 1047] : mood === "sad" ? [440, 392, 311] : [523];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = mood === "happy" ? "triangle" : "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime + i * 0.1;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.25);
  });
}

export function playStamp() {
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(200, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.08);
  gain.gain.value = 0.12;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
  osc.stop(ctx.currentTime + 0.1);
}
