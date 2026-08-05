
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomGroups, getClassroomMembers } from "@/lib/teacherClassroom";

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { ScrollText, Award } from "lucide-react";
import { ROUTES } from '@/lib/routes';

const LABELS = {
  scan: { label: "QR Scan", color: "sky" },
  gacha_win: { label: "Gacha Win", color: "lime" },
  gacha_loss: { label: "Gacha Loss", color: "coral" },
  gacha_even: { label: "Gacha Even", color: "sun" },
  behavior_penalty: { label: "Penalty", color: "coral" },
  mission_redemption: { label: "Mission XP", color: "purple" },
  redemption: { label: "Reward Redeemed", color: "pink" },
  badge: { label: "Badge Reward", color: "sun" },
};

export default function ActivityLogs() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    const [logs, redemptions, badges, groups, members] = await Promise.all([
      db.entities.ParticipationLog.filter({ classroom_id: c.id }),
      db.entities.RewardRedemption.filter({ classroom_id: c.id }),
      db.entities.Badge.filter({ classroom_id: c.id }),
      getClassroomGroups(c.id),
      getClassroomMembers(c.id),
    ]);
    const gmap = Object.fromEntries(groups.map((g) => [g.id, g.group_number]));
    const mmap = Object.fromEntries(members.map((m) => [m.id, `${m.last_name}, ${m.first_name}`]));

    const logEntries = logs.map((l) => ({
      id: `log-${l.id}`,
      type: l.event_type || "scan",
      points: l.points_awarded,
      groupLabel: gmap[l.group_id] ? `Group ${gmap[l.group_id]}` : null,
      memberLabel: mmap[l.group_member_id] || null,
      note: l.note,
      created_date: l.created_date,
    }));

    const redemptionEntries = redemptions.map((r) => ({
      id: `redemption-${r.id}`,
      type: "redemption",
      points: -Math.abs(r.points_spent || 0),
      groupLabel: gmap[r.group_id] ? `Group ${gmap[r.group_id]}` : null,
      memberLabel: null,
      note: r.reward_title,
      created_date: r.created_date,
    }));

    const badgeEntries = badges.map((b) => ({
      id: `badge-${b.id}`,
      type: "badge",
      points: null,
      groupLabel: gmap[b.group_id] ? `Group ${gmap[b.group_id]}` : null,
      memberLabel: null,
      note: b.title,
      created_date: b.created_date,
    }));

    const merged = [...logEntries, ...redemptionEntries, ...badgeEntries].sort(
      (a, b) => (b.created_date || "").localeCompare(a.created_date || "")
    );

    setEntries(merged);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2">
          <ScrollText className="w-6 h-6" /> Activity Logs
        </h1>
        <p className="text-ink/60 text-sm">Every scan, gacha result, redemption, and badge award in your classroom.</p>
      </div>

      {entries.length === 0 && (
        <p className="text-ink/50 text-sm text-center">No activity yet.</p>
      )}

      {entries.map((e) => {
        const meta = LABELS[e.type] || { label: e.type, color: "purple" };
        return (
          <ClayCard key={e.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ClayChip color={meta.color}>{meta.label}</ClayChip>
                  {e.groupLabel && <ClayChip color="sky">{e.groupLabel}</ClayChip>}
                </div>
                {(e.memberLabel || e.note) && (
                  <p className="text-sm text-ink/70 mt-2 truncate">
                    {e.memberLabel ? `${e.memberLabel} — ` : ""}
                    {e.note}
                  </p>
                )}
                {e.created_date && (
                  <p className="text-[10px] text-ink/40 mt-1 font-mono">
                    {new Date(e.created_date).toLocaleString()}
                  </p>
                )}
              </div>
              {e.points != null && (
                <div className="text-right shrink-0 flex items-center gap-1">
                  {e.type === "badge" ? (
                    <Award className="w-5 h-5 text-clay-sun" />
                  ) : (
                    <p className={`font-mono font-extrabold text-lg ${e.points < 0 ? "text-clay-coral" : "text-clay-lime"}`}>
                      {e.points > 0 ? "+" : ""}
                      {e.points}
                    </p>
                  )}
                </div>
              )}
            </div>
          </ClayCard>
        );
      })}
    </div>
  );
}

