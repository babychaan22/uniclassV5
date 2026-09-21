
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomGroups, getClassroomMembers } from "@/lib/teacherClassroom";

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import ClayButton from "@/components/ClayButton";
import PointRecipientCorrection from "@/components/teacher/PointRecipientCorrection";
import { ScrollText, Award, ArrowRightLeft } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import { correctParticipationRecipient } from '@/lib/secureActions';

const LABELS = {
  scan: { label: "QR Scan", color: "sky" },
  gacha_win: { label: "Gacha Win", color: "lime" },
  gacha_loss: { label: "Gacha Loss", color: "coral" },
  gacha_even: { label: "Gacha Even", color: "sun" },
  behavior_penalty: { label: "Penalty", color: "coral" },
  mission_redemption: { label: "Mission XP", color: "purple" },
  redemption: { label: "Reward Redeemed", color: "pink" },
  badge: { label: "Badge Reward", color: "sun" },
  point_correction: { label: "Point correction", color: "purple" },
};

const CORRECTABLE_TYPES = new Set(['scan', 'gacha_win', 'gacha_even', 'mission_redemption']);

export default function ActivityLogs() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [members, setMembers] = useState([]);
  const [correction, setCorrection] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => { load(); }, [user]);

  async function load(nextPage = 0) {
    if (!user) return;
    if (nextPage > 0) setLoadingMore(true);
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    const offset = nextPage * 100;
    const [logs, redemptions, badges, groups, members] = await Promise.all([
      db.entities.ParticipationLog.filter({ classroom_id: c.id }, { orderBy: 'created_date', ascending: false, limit: 100, offset }),
      db.entities.RewardRedemption.filter({ classroom_id: c.id }, { orderBy: 'created_date', ascending: false, limit: 100, offset }),
      db.entities.Badge.filter({ classroom_id: c.id }, { orderBy: 'created_date', ascending: false, limit: 100, offset }),
      getClassroomGroups(c.id), getClassroomMembers(c.id),
    ]);
    setHasMore(logs.length === 100 || redemptions.length === 100 || badges.length === 100);
    const gmap = Object.fromEntries(groups.map((g) => [g.id, g.group_number]));
    const mmap = Object.fromEntries(members.map((m) => [m.id, `${m.last_name}, ${m.first_name}`]));
    setMembers(members);

    const logEntries = logs.map((l) => ({
      id: `log-${l.id}`,
      type: l.event_type || "scan",
      points: Number(l.points_awarded || 0),
      groupLabel: gmap[l.group_id] ? `Group ${gmap[l.group_id]}` : (c.uses_groups ? null : 'Individual'),
      memberLabel: l.recipient_type === 'group' || !l.group_member_id ? 'WHOLE GROUP' : mmap[l.group_member_id] || null,
      note: l.event_type === 'mission_redemption'
        ? `${formatAmount(l.xp_spent)} XP redeemed for ${formatAmount(l.points_awarded)} participation point${Number(l.points_awarded) === 1 ? '' : 's'}`
        : l.note,
      created_date: l.created_date,
      sourceLogId: l.id,
      group_id: l.group_id,
      group_member_id: l.group_member_id,
      correctable: CORRECTABLE_TYPES.has(l.event_type) && Number(l.points_awarded || 0) > 0,
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

    setEntries((current) => nextPage === 0
      ? merged
      : [...current, ...merged].filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index)
    );
    setPage(nextPage);
    setLoading(false);
    setLoadingMore(false);
  }

  async function saveCorrection(sourceLogId, targetMemberId) {
    await correctParticipationRecipient(sourceLogId, targetMemberId);
    setCorrection(null);
    setNotice('Points were moved and the original award was kept in the audit history.');
    await load();
    window.setTimeout(() => setNotice(''), 4500);
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
      {notice && <p className="rounded-xl border-2 border-clay-lime/40 bg-clay-lime/15 px-3 py-2 text-sm font-bold text-ink">{notice}</p>}


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
            {e.correctable && <div className="mt-3 border-t-2 border-ink/10 pt-3"><ClayButton size="sm" color="cream" onClick={() => setCorrection(correction?.sourceLogId === e.sourceLogId ? null : e)}><ArrowRightLeft className="h-4 w-4" /> Correct recipient</ClayButton>{correction?.sourceLogId === e.sourceLogId && <PointRecipientCorrection entry={e} members={members} onCancel={() => setCorrection(null)} onSave={saveCorrection} />}</div>}
            </div>
          </ClayCard>
        );
      })}
      {hasMore && <ClayButton onClick={() => load(page + 1)} color="white" className="w-full" disabled={loadingMore}>
        {loadingMore ? "Loading…" : "Load older activity"}
      </ClayButton>}
    </div>
  );
}

function formatAmount(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value || 0));
}
