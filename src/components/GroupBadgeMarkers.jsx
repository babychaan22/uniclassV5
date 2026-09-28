import { useGroupBadgeData } from "@/components/GroupBadgeContext";
import { getGroupBadgeItems } from "@/lib/groupBadges";

export default function GroupBadgeMarkers({ groupId, badges, definitions, className = "" }) {
  const context = useGroupBadgeData();
  const currentBadges = context.badges.length ? context.badges : (badges || []);
  const currentDefinitions = context.definitions.length ? context.definitions : (definitions || []);
  const items = getGroupBadgeItems(currentBadges, currentDefinitions, context.now).filter((badge) => badge.group_id === groupId);
  if (!items.length) return null;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label={`Group badges: ${items.map((badge) => badge.label).join(", ")}`}>
      {items.map((badge) => (
        <span key={badge.id} role="img" aria-label={badge.label} title={badge.label} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-clay-sun/25 text-sm">
          {badge.icon}
        </span>
      ))}
    </span>
  );
}
