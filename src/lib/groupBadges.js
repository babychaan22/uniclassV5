import { getWeekStartManila, isWeekdayManila } from "@/lib/week";

const SYSTEM_BADGES = {
  weekly_90_activity: { label: "90% Activity Squad", icon: "🎯" },
  weekly_full_attendance: { label: "Perfect Attendance", icon: "📅" },
  weekly_top_group_points: { label: "Top Group Points", icon: "🏆" },
  weekly_top_individual_points: { label: "Top Point Earner", icon: "⭐" },
};

export function getGroupBadgeItems(badges = [], definitions = [], date = new Date()) {
  if (!isWeekdayManila(date)) return [];

  const weekStart = getWeekStartManila(date);
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  return badges
    .filter((badge) => badge.visible_week_start_date === weekStart && ["pending", "approved"].includes(badge.approval_status))
    .map((badge) => {
      const definition = definitionsById.get(badge.badge_definition_id);
      const systemBadge = SYSTEM_BADGES[badge.badge_type];
      const label = definition?.title || systemBadge?.label || badge.badge_type.replaceAll("_", " ");
      return {
        ...badge,
        label: `${label}${badge.approval_status === "pending" ? " (awaiting approval)" : ""}`,
        icon: definition?.icon || systemBadge?.icon || "🏅",
      };
    });
}
