
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "w-14 md:w-16",
  md: "w-20 md:w-24",
  lg: "w-28 md:w-36",
  hero: "w-36 md:w-48 lg:w-56",
};

const NOVA_ROBOT = "/nova/nova-robot.png";
const NOVA_CELEBRATE = "/nova/nova-robot-celebrate.png";
const NOVA_THINKING = "/nova/nova-robot-thinking.png";
const ASSET_BY_VARIANT = {
  welcome: NOVA_ROBOT,
  celebrate: NOVA_CELEBRATE,
  teacher: NOVA_ROBOT,
  achievement: NOVA_CELEBRATE,
  idea: NOVA_THINKING,
};

export function NovaImage({ variant = "welcome", size = "md", className = "", priority = false, alt = "" }) {
  const src = ASSET_BY_VARIANT[variant] || NOVA_ROBOT;

  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={cn(
        "select-none object-contain",
        // Callers that place Nova inside a card provide exact dimensions. Do not
        // let the responsive default width override those layout constraints.
        !className && (SIZES[size] || SIZES.md),
        className,
      )}
    />
  );
}

export default function Nova({ variant = "welcome", size = "md", className = "", priority = false }) {
  return <NovaImage variant={variant} size={size} className={className} priority={priority} alt="" />;
}
