
import { cn } from "@/lib/utils";
import { NovaAsset } from "@/components/visual/UIAsset";

const POSE_TO_ASSET = {
  welcome: "welcome",
  learning: "learning",
  thinking: "thinking",
  achievement: "achievement",
  tablet: "ai",
};

export default function NovaGuide({ pose = "welcome", className = "", label = "Nova, your UniClass guide" }) {
  const assetPose = POSE_TO_ASSET[pose] || POSE_TO_ASSET.welcome;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "relative flex h-16 w-16 shrink-0 items-end justify-center overflow-visible",
        className,
      )}
    >
      <NovaAsset pose={assetPose} className="h-full w-full object-bottom drop-shadow-[0_8px_10px_rgba(16,32,101,.18)]" />
    </div>
  );
}
