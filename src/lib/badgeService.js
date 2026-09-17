
import { getWeekStartManila, isEndOfWeekManila } from "./week";
import { supabase } from "@/api/supabaseClient";

export async function redeemBadge(groupId, badgeType, userId) {
  const db = globalThis.__B44_DB__;
  if (!isEndOfWeekManila()) {
    return { error: "Badges are only available at the end of the week (Saturday–Sunday)." };
  }
  const weekStart = getWeekStartManila();

  try {
    const { data, error } = await supabase.rpc("redeem_badge", {
      p_group_id: groupId,
      p_badge_type: badgeType,
    });
    if (error) throw error;
    return { success: true, badge: data, points: data?.points_awarded || 0 };
  } catch (err) {
    return { error: err.message || "Redemption failed." };
  }
}
