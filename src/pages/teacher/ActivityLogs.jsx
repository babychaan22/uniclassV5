
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
import PointsAward from "@/components/teacher/PointsAward";
import { ScrollText, ArrowRightLeft, Undo2 } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import { correctParticipationRecipient, voidParticipationEntry, awardParticipationPoints } from '@/lib/secureActions';
import { signedPoints } from '@/lib/stats';

// Keys here are participation_logs.event_type values, nothing else. 'redemption'
// is NOT one of them: reward redemptions are not logged rows at all, so they are
// given their own type below and labelled separately. Keeping a name in this map
// that the database forbids invites code that trusts it as the event domain.
const LOG_LABELS = {
  scan: { label: "QR Scan", color: "sky" },
  gacha_win: { label: "Gacha Win", color: "lime" },
  gacha_loss: { label: "Gacha Loss", color: "coral" },
  gacha_even: { label: "Gacha Even", color: "sun" },
  behavior_penalty: { label: "Penalty", color: "coral" },
  mission_redemption: { label: "Mission XP", color: "purple" },
  badge: { label: "Badge Reward", color: "sun" },
  point_correction: { label: "Point correction", color: "purple" },
  manual_award: { label: "Points Awarded", color: "lime" },
};

// Entry types this page synthesises for display, for rows that are not
// participation_logs at all.
const SYNTHETIC_LABELS = {
  redemption: { label: "Reward Redeemed", color: "pink" },
};

const labelFor = (type) =>
  LOG_LABELS[type] || SYNTHETIC_LABELS[type] || { label: type, color: "cream" };

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
  const [groups, setGroups] = useState([]);
  const [correction, setCorrection] = useState(null);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(null);
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
    setGroups(groups || []);
    setHasMore(logs.length === 100 || redemptions.length === 100 || badges.length === 100);
    const gmap = Object.fromEntries(groups.map((g) => [g.id, g.group_number]));
    const mmap = Object.fromEntries(members.map((m) => [m.id, `${m.last_name}, ${m.first_name}`]));
    setMembers(members);

const logEntries = logs.map((l) => {
      const movedOriginal = Number(l.points_awarded || 0) === 0 && (l.note?.startsWith('Recipient correction:') || l.note?.startsWith('Superseded duplicate:'));
      // A removed entry keeps its row and its history: the award is zeroed and
      // the amount it used to carry is shown struck through.
      const removed = Boolean(l.reversed_at);
      return {
        id: `log-${l.id}`,
        type: l.event_type || "scan",
        // A penalty is stored positive and reads as a deduction everywhere else,
        // so the log has to show it the same way or a teacher sees "+5".
        points: movedOriginal || removed ? null : signedPoints(l),
        removedPoints: removed ? Number(l.reversed_points || 0) : null,
        removed,
        removalReason: l.reversal_reason || null,
        groupLabel: gmap[l.group_id] ? `Group ${gmap[l.group_id]}` : (c.uses_groups ? 'Unassigned group' : 'Whole class'),
        memberLabel: (movedOriginal || removed) ? null : (l.recipient_type === 'group' || !l.group_member_id ? 'WHOLE GROUP' : mmap[l.group_member_id] || null),
        note: movedOriginal ? l.note : (removed
          ? [l.note, l.reversed_points ? `${formatAmount(l.reversed_points)} pts returned` : 'nothing had been awarded', l.reversal_reason].filter(Boolean).join(' · ')
          : (l.event_type === 'mission_redemption'
            ? `${formatAmount(l.xp_spent)} XP redeemed for ${formatAmount(l.points_awarded)} participation point${Number(l.points_awarded) === 1 ? '' : 's'}`
            : l.note)),
        created_date: l.created_date,
        sourceLogId: l.id,
        group_id: l.group_id,
        group_member_id: l.group_member_id,
        correctable: CORRECTABLE_TYPES.has(l.event_type) && Number(l.points_awarded || 0) > 0,
        voidable: !removed && !movedOriginal
          && ['scan', 'gacha_win', 'gacha_even', 'manual_award', 'behavior_penalty', 'mission_redemption'].includes(l.event_type)
          && (Number(l.points_awarded || 0) > 0 || Number(l.xp_spent || 0) > 0),
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

  async function saveVoid(entry) {
    setVoiding(entry.sourceLogId);
    try {
      await voidParticipationEntry(entry.sourceLogId, voidReason.trim() || null);
      setVoidTarget(null);
      setVoidReason('');
      invalidateClassroomDataset();
      setNotice('Entry removed. It stays in the log marked as removed, and the student can see it was taken back.');
      await load();
      window.setTimeout(() => setNotice(''), 4500);
    } catch (err) {
      setNotice(err.message || 'Could not remove that entry.');
      window.setTimeout(() => setNotice(''), 4500);
    } finally {
      setVoiding(null);
    }
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
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2">
          <ScrollText className="w-6 h-6" /> Activity Logs
        </h1>
        <p className="text-ink/60 text-sm">Every scan, gacha result, redemption, and badge award in your classroom.</p>
      </div>
      {notice && <p className="rounded-xl border-2 border-clay-lime/40 bg-clay-lime/15 px-3 py-2 text-sm font-bold text-ink">{notice}</p>}

      <PointsAward
        groups={groups}
        members={members}
        onAward={async (groupId, points, memberId, note) => {
          await awardParticipationPoints(groupId, points, memberId, note);
          invalidateClassroomDataset();
          setNotice('Points awarded. They are in the log and in the student\'s account history.');
          await load();
          window.setTimeout(() => setNotice(''), 4500);
        }}
      />

      {entries.length === 0 && (
        <p className="text-ink/50 text-sm text-center">No activity yet.</p>
      )}

      {orderedGroups.length > 0 && (
        /* One card per group across the full width. Each card scrolls its own
           history, so the panel stays a fixed height no matter how much older
           activity has been loaded. */
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 items-start">
          {orderedGroups.map((section) => (
            <ClayCard key={section.label} className="p-3 border-2 border-ink/10 bg-cream/40 shadow-sm flex flex-col min-h-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1 font-display font-bold text-sm text-ink/90 truncate">
                  {section.label} <GroupBadgeMarkers groupId={section.groupId} />
                </p>
                <ClayChip color="sky" className="px-2 py-0.5 text-xs shrink-0">{section.entries.length} item{section.entries.length === 1 ? '' : 's'}</ClayChip>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto overscroll-contain pr-1">
                {section.entries.map((e) => {
                  const meta = labelFor(e.type);
                  return (
                    <div key={e.id} className={`rounded-lg border border-ink/10 bg-white/80 px-2.5 py-1.5 ${e.removed ? 'opacity-70' : ''}`}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <ClayChip color={meta.color} className="px-2 py-0.5 text-[11px]">{meta.label}</ClayChip>
                            {e.removed && <ClayChip color="coral" className="px-2 py-0.5 text-[11px]">Removed</ClayChip>}
                            {e.memberLabel && <span className="text-xs font-display font-bold">{e.memberLabel}</span>}
                            <span className="text-[10px] font-mono text-ink/40 ml-auto">{e.created_date ? new Date(e.created_date).toLocaleString() : ''}</span>
                          </div>
                          {e.note && <p className="mt-0.5 text-xs text-ink/65 break-words">{e.note}</p>}
                        </div>
                        {e.removed ? (
                          <p className="shrink-0 font-mono font-extrabold text-ink/40 line-through">
                            {e.removedPoints ? `+${e.removedPoints}` : ''}
                          </p>
                        ) : e.points != null ? (
                          <p className={`shrink-0 font-mono font-extrabold ${e.points < 0 ? 'text-clay-coral' : 'text-clay-lime'}`}>
                            {e.points > 0 ? '+' : ''}{e.points}
                          </p>
                        ) : null}
                        {e.pendingPoints != null && (
                          <p className="shrink-0 font-mono font-extrabold text-ink/40" title="Added only after approval">
                            +{e.pendingPoints}
                          </p>
                        )}
                      </div>
                      {(e.correctable || e.voidable) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {e.correctable && (
                            <ClayButton size="sm" color="cream" onClick={() => setCorrection(correction?.sourceLogId === e.sourceLogId ? null : e)}>
                              <ArrowRightLeft className="h-3.5 w-3.5" /> Correct recipient
                            </ClayButton>
                          )}
                          {e.voidable && (
                            <ClayButton
                              size="sm"
                              color="coral"
                              onClick={() => setVoidTarget(voidTarget?.sourceLogId === e.sourceLogId ? null : e)}
                              title="Take these points back. The entry stays visible, marked as removed."
                            >
                              <Undo2 className="h-3.5 w-3.5" /> Remove entry
                            </ClayButton>
                          )}
                          {correction?.sourceLogId === e.sourceLogId && (
                            <PointRecipientCorrection entry={e} members={members} onCancel={() => setCorrection(null)} onSave={saveCorrection} />
                          )}
                          {voidTarget?.sourceLogId === e.sourceLogId && (
                            <div className="w-full rounded-lg border-2 border-clay-coral/40 bg-clay-coral/10 p-2">
                              <p className="text-xs font-bold text-ink">
                                Take back {e.points ? `${formatAmount(e.points)} points` : `${formatAmount(e.points_awarded)} points`}? The entry stays in the log marked as removed, and the student can see it happened.
                              </p>
                              <input
                                className="clay-input mt-2 text-xs"
                                placeholder="Reason (optional, e.g. duplicate scan)"
                                value={voidReason}
                                onChange={(ev) => setVoidReason(ev.target.value)}
                              />
                              <div className="mt-2 flex items-center gap-2">
                                <ClayButton size="sm" color="coral" disabled={voiding === e.sourceLogId} onClick={() => saveVoid(e)}>
                                  {voiding === e.sourceLogId ? 'Removing…' : 'Yes, remove it'}
                                </ClayButton>
                                <ClayButton size="sm" color="cream" onClick={() => setVoidTarget(null)}>Cancel</ClayButton>
                              </div>
                            </div>
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
