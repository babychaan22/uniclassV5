
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomGroups, getClassroomMembers, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import ClayButton from "@/components/ClayButton";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import PointRecipientCorrection from "@/components/teacher/PointRecipientCorrection";
import { ScrollText, ArrowRightLeft } from "lucide-react";
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

const SYSTEM_BADGE_LABELS = {
  weekly_90_activity: '90% Activity Squad',
  weekly_full_attendance: 'Perfect Attendance',
  weekly_top_group_points: 'Top Group Points',
  weekly_top_individual_points: 'Top Point Earner',
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
  const [definitions, setDefinitions] = useState([]);

  useEffect(() => { load(); }, [user]);

  async function load(nextPage = 0) {
    if (!user) return;
    if (nextPage > 0) setLoadingMore(true);
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    const offset = nextPage * 100;
    const [logs, redemptions, badges, groups, members, badgeDefinitions] = await Promise.all([
      db.entities.ParticipationLog.filter({ classroom_id: c.id }, { orderBy: 'created_date', ascending: false, limit: 100, offset }),
      db.entities.RewardRedemption.filter({ classroom_id: c.id }, { orderBy: 'created_date', ascending: false, limit: 100, offset }),
      db.entities.Badge.filter({ classroom_id: c.id }, { orderBy: 'created_date', ascending: false, limit: 100, offset }),
      getClassroomGroups(c.id), getClassroomMembers(c.id),
      db.entities.BadgeDefinition.filter({ classroom_id: c.id }),
    ]);
    setDefinitions(badgeDefinitions || []);
    setHasMore(logs.length === 100 || redemptions.length === 100 || badges.length === 100);
    const gmap = Object.fromEntries(groups.map((g) => [g.id, g.group_number]));
    const mmap = Object.fromEntries(members.map((m) => [m.id, `${m.last_name}, ${m.first_name}`]));
    setMembers(members);

    const logEntries = logs.map((l) => {
      const movedOriginal = Number(l.points_awarded || 0) === 0 && (l.note?.startsWith('Recipient correction:') || l.note?.startsWith('Superseded duplicate:'));
      return {
      id: `log-${l.id}`,
      type: l.event_type || "scan",
      points: movedOriginal ? null : Number(l.points_awarded || 0),
      groupLabel: gmap[l.group_id] ? `Group ${gmap[l.group_id]}` : (c.uses_groups ? 'Unassigned group' : 'Whole class'),
      memberLabel: movedOriginal ? null : (l.recipient_type === 'group' || !l.group_member_id ? 'WHOLE GROUP' : mmap[l.group_member_id] || null),
      note: movedOriginal ? l.note : (l.event_type === 'mission_redemption'
        ? `${formatAmount(l.xp_spent)} XP redeemed for ${formatAmount(l.points_awarded)} participation point${Number(l.points_awarded) === 1 ? '' : 's'}`
        : l.note),
      created_date: l.created_date,
      sourceLogId: l.id,
      group_id: l.group_id,
      group_member_id: l.group_member_id,
      correctable: CORRECTABLE_TYPES.has(l.event_type) && Number(l.points_awarded || 0) > 0,
    }; });

    const redemptionEntries = redemptions.map((r) => ({
      id: `redemption-${r.id}`,
      type: "redemption",
      points: null,
      groupLabel: gmap[r.group_id] ? `Group ${gmap[r.group_id]}` : (c.uses_groups ? 'Unassigned group' : 'Whole class'),
      group_id: r.group_id,
      memberLabel: null,
      note: `${r.reward_title} · ${r.approval_status === 'approved' ? 'approved' : r.approval_status === 'rejected' ? 'declined' : 'awaiting approval'} · no points deducted`,
      created_date: r.created_date,
    }));

    const badgeEntries = badges.map((b) => {
      const definition = definitions.find((item) => item.id === b.badge_definition_id);
      const label = definition?.title
        || SYSTEM_BADGE_LABELS[b.badge_type]
        || b.badge_type.replace(/^custom:[0-9a-f-]+(:[0-9a-f-]+)?$/, "Badge").replaceAll("_", " ");
      const points = Number(b.points_awarded || 0);
      // A pending request has not moved any points yet; showing "+10" on an
      // unapproved badge reads as if the group was already credited.
      const status = b.approval_status || "pending";
      const approved = status === "approved";
      return {
        id: `badge-${b.id}`,
        type: "badge",
        points: approved ? points : null,
        pendingPoints: approved ? null : points,
        groupLabel: gmap[b.group_id] ? `Group ${gmap[b.group_id]}` : (c.uses_groups ? 'Unassigned group' : 'Whole class'),
        group_id: b.group_id,
        memberLabel: b.member_id && mmap[b.member_id] ? mmap[b.member_id] : null,
        note: `${label} · ${approved ? `approved · +${points} pts` : status === 'rejected' ? 'declined · no points added' : `awaiting approval · +${points} pts on approval`}`,
        created_date: b.created_date,
      };
    });

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
    invalidateClassroomDataset();
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

  const groupedEntries = Object.values(entries.reduce((groups, entry) => {
    const key = entry.groupLabel || 'Whole class';
    if (!groups[key]) groups[key] = { label: key, groupId: entry.group_id, entries: [] };
    groups[key].entries.push(entry);
    return groups;
  }, {}));

  const orderedGroups = [...groupedEntries].sort((a, b) => {
    const left = Number(a.groupId ?? 0);
    const right = Number(b.groupId ?? 0);
    if (left && right && left !== right) return left - right;
    return String(a.label).localeCompare(String(b.label), undefined, { numeric: true, sensitivity: 'base' });
  });

  return (
    <div className="max-w-3xl mx-auto space-y-5">
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

      {orderedGroups.length > 0 && (
        <div className="space-y-3 max-h-[68vh] overflow-y-auto pr-1">
          {orderedGroups.map((section) => (
            <ClayCard key={section.label} className="p-3 border-2 border-ink/10 bg-cream/40 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1 font-display font-bold text-sm text-ink/90">
                  {section.label} <GroupBadgeMarkers groupId={section.groupId} />
                </p>
                <ClayChip color="sky">{section.entries.length} item{section.entries.length === 1 ? '' : 's'}</ClayChip>
              </div>
              <div className={`space-y-2 ${section.entries.length > 4 ? 'max-h-56 overflow-y-auto pr-1' : ''}`}>
                {section.entries.map((e) => {
                  const meta = LABELS[e.type] || { label: e.type, color: 'purple' };
                  return (
                    <div key={e.id} className="rounded-xl border border-ink/10 bg-white/80 px-3 py-2">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <ClayChip color={meta.color}>{meta.label}</ClayChip>
                            {e.memberLabel && <span className="text-xs font-display font-bold">{e.memberLabel}</span>}
                          </div>
                          {e.note && <p className="mt-1 text-xs text-ink/65 break-words">{e.note}</p>}
                          <p className="mt-1 text-[10px] font-mono text-ink/40">{e.created_date ? new Date(e.created_date).toLocaleString() : ''}</p>
                        </div>
                        {e.points != null && (
                          <p className={`shrink-0 font-mono font-extrabold ${e.points < 0 ? 'text-clay-coral' : 'text-clay-lime'}`}>
                            {e.points > 0 ? '+' : ''}{e.points}
                          </p>
                        )}
                        {e.pendingPoints != null && (
                          <p className="shrink-0 font-mono font-extrabold text-ink/40" title="Added only after approval">
                            +{e.pendingPoints}
                          </p>
                        )}
                      </div>
                      {e.correctable && (
                        <div className="mt-2">
                          <ClayButton size="sm" color="cream" onClick={() => setCorrection(correction?.sourceLogId === e.sourceLogId ? null : e)}>
                            <ArrowRightLeft className="h-3.5 w-3.5" /> Correct recipient
                          </ClayButton>
                          {correction?.sourceLogId === e.sourceLogId && (
                            <PointRecipientCorrection entry={e} members={members} onCancel={() => setCorrection(null)} onSave={saveCorrection} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ClayCard>
          ))}
        </div>
      )}

      {hasMore && <ClayButton onClick={() => load(page + 1)} color="white" className="w-full" disabled={loadingMore}>
        {loadingMore ? "Loading…" : "Load older activity"}
      </ClayButton>}
    </div>
  );
}

function formatAmount(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value || 0));
}
