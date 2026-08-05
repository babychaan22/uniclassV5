const STATE_ASSET = {
  idle: "/mascots/nova-welcome.png",
  waiting: "/mascots/nova-music.png",
  excited: "/mascots/nova-success.png",
  ai_thinking: "/mascots/nova-thinking.png",
  quest: "/mascots/nova-quest.png",
  gacha: "/mascots/nova-laptop.png",
  error: "/mascots/nova-thinking.png",
};

const STATE_COPY = {
  idle: "Nova, your UniClass companion",
  waiting: "Nova is enjoying music while waiting",
  excited: "Nova is celebrating",
  ai_thinking: "Professor Nova has an idea",
  quest: "Nova is preparing a learning quest",
  gacha: "Nova is hosting the capsule draw",
  error: "Nova is helping solve the problem",
};

export function MascotBadge({ skinKey = "nova" }) {
  const src = skinKey === "cyber_nova" ? "/mascots/nova-laptop.png" : skinKey === "gold_crown" ? "/mascots/nova-success.png" : "/mascots/nova-welcome.png";
  return <img src={src} alt="Nova avatar" className="h-9 w-9 object-contain" />;
}

export default function MascotWidget({ state = "idle", size = "md", interactive = false, onClick, className = "" }) {
  const dimensions = size === "sm" ? "h-14 w-14" : size === "lg" ? "h-48 w-48" : "h-28 w-28";
  const img = <img src={STATE_ASSET[state] || STATE_ASSET.idle} alt={STATE_COPY[state] || STATE_COPY.idle} className="h-full w-full object-contain" />;
  if (!interactive) return <div className={`nova-mascot nova-${state} inline-flex shrink-0 ${dimensions} ${state === "excited" ? "nova-bounce" : ""} ${state === "ai_thinking" ? "nova-think" : ""} ${className}`}>{img}</div>;
  return <button type="button" onClick={onClick} aria-label={STATE_COPY[state] || STATE_COPY.idle} className={`nova-mascot nova-${state} inline-flex shrink-0 cursor-pointer ${dimensions} ${state === "excited" ? "nova-bounce" : ""} ${className}`}>{img}</button>;
}
