import { AlertCircle, Brain, Clock3, Dices, GraduationCap, PartyPopper, Target, Smile } from "lucide-react";

const STATE_ASSET = {
  idle: Smile,
  waiting: Clock3,
  excited: PartyPopper,
  ai_thinking: Brain,
  quest: Target,
  gacha: Dices,
  error: AlertCircle,
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

export function MascotBadge() {
  return <GraduationCap aria-label="UniClass learning logo" className="h-6 w-6 text-white" />;
}

export default function MascotWidget({ state = "idle", size = "md", interactive = false, onClick, className = "" }) {
  const dimensions = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-28 w-28" : "h-14 w-14";
  const Icon = STATE_ASSET[state] || STATE_ASSET.idle;
  const iconColor = state === "error" ? "text-clay-coral" : state === "excited" ? "text-clay-sun" : "text-clay-purple";
  const img = <Icon aria-hidden="true" className={`h-3/5 w-3/5 ${iconColor}`} strokeWidth={2.5} />;
  const sizeClass = `nova-size-${size}`;
  if (!interactive) return <div className={`nova-mascot nova-${state} ${sizeClass} inline-flex shrink-0 ${dimensions} ${state === "excited" ? "nova-bounce" : ""} ${state === "ai_thinking" ? "nova-think" : ""} ${className}`}>{img}</div>;
  return <button type="button" onClick={onClick} aria-label={STATE_COPY[state] || STATE_COPY.idle} className={`nova-mascot nova-${state} ${sizeClass} inline-flex shrink-0 cursor-pointer ${dimensions} ${state === "excited" ? "nova-bounce" : ""} ${className}`}>{img}</button>;
}
