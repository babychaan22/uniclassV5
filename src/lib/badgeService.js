
import { getWeekStartManila, isEndOfWeekManila } from "./week";

export async function redeemBadge(groupId, badgeType, userId) {
  const db = globalThis.__B44_DB__;
  if (!isEndOfWeekManila()) {
    return { error: "Badges are only available at the end of the week (Saturday–Sunday)." };
  }
  const weekStart = getWeekStartManila();

  try {
    const existing = await db.entities.Badge.filter({
      group_id: groupId,
      badge_type: badgeType,
      week_start_date: weekStart,
    });
    if (existing.length > 0) {
      return { error: "This badge has already been claimed this week." };
    }

    const group = await db.entities.Group.get(groupId);
    const classroomId = group.classroom_id;
    const members = await db.entities.GroupMember.filter({ group_id: groupId });

    const weekEnd = addDays(weekStart, 6);

    const [allGroups, allMembers, attendance, activityScores, activities, logs] = await Promise.all([
      db.entities.Group.filter({ classroom_id: classroomId }),
      db.entities.GroupMember.filter({ classroom_id: classroomId }),
      db.entities.Attendance.filter({ classroom_id: classroomId }),
      db.entities.ActivityScore.filter({ classroom_id: classroomId }),
      db.entities.Activity.filter({ classroom_id: classroomId }),
      db.entities.ParticipationLog.filter({ classroom_id: classroomId }),
    ]);

    const inWeek = (d) => {
      const day = (d || "").slice(0, 10);
      return day >= weekStart && day <= weekEnd;
    };

    let eligible = false;
    let points = 0;

    if (badgeType === "weekly_90_activity") {
      points = 20;
      eligible = members.length > 0 && members.every((m) => {
        const scores = activityScores.filter((s) => s.group_member_id === m.id && inWeek(s.created_date));
        if (scores.length === 0) return false;
        let ts = 0, tm = 0;
        for (const s of scores) {
          const act = activities.find((a) => a.id === s.activity_id);
          if (act) { ts += s.score; tm += act.max_score; }
        }
        return tm > 0 && ts / tm >= 0.9;
      });
    } else if (badgeType === "weekly_full_attendance") {
      points = 10;
      const weekAttendance = attendance.filter((a) => inWeek(a.attendance_date));
      eligible = members.length > 0 && members.every((m) => {
        const recs = weekAttendance.filter((a) => a.group_member_id === m.id);
        return recs.length > 0 && recs.every((r) => r.status === "present");
      });
    } else if (badgeType === "weekly_top_group_points") {
      points = 20;
      const groupTotals = {};
      for (const g of allGroups) {
        groupTotals[g.id] = logs
          .filter((l) => l.group_id === g.id && inWeek(l.created_date))
          .reduce((s, l) => s + (l.points_awarded || 0), 0);
      }
      const max = Math.max(...Object.values(groupTotals));
      eligible = max > 0 && groupTotals[groupId] === max;
    } else if (badgeType === "weekly_top_individual_points") {
      points = 20;
      const memberTotals = {};
      for (const m of allMembers) {
        memberTotals[m.id] = logs
          .filter((l) => l.group_member_id === m.id && inWeek(l.created_date))
          .reduce((s, l) => s + (l.points_awarded || 0), 0);
      }
      const max = Math.max(...Object.values(memberTotals));
      const topMemberId = Object.keys(memberTotals).find((id) => memberTotals[id] === max);
      eligible = max > 0 && members.some((m) => m.id === topMemberId);
    }

    if (!eligible) {
      return { error: "Not eligible for this badge this week." };
    }

    let badge;
    try {
      badge = await db.entities.Badge.create({
        group_id: groupId,
        classroom_id: classroomId,
        badge_type: badgeType,
        week_start_date: weekStart,
        points_awarded: points,
        redeemed_by: userId,
      });
    } catch (err) {
      // Postgres unique_violation — another request claimed this badge
      // first (see badges_unique_weekly_award constraint).
      if (err?.code === "23505") {
        return { error: "This badge has already been claimed this week." };
      }
      throw err;
    }

    await db.entities.ParticipationLog.bulkCreate(
      members.map((m) => ({
        group_member_id: m.id,
        group_id: groupId,
        classroom_id: classroomId,
        qr_code_id: badge.id,
        points_awarded: points / members.length,
        event_type: "scan",
        multiplier: 1,
      }))
    );

    return { success: true, badge, points };
  } catch (err) {
    return { error: err.message || "Redemption failed." };
  }
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

