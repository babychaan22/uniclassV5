// Only the import line changes — the entire caching logic is identical.
import { db as base44 } from "@/api/supabaseClient";

// Module-level cache for the current teacher's classroom record.
let cache = null; // { userId, promise, ts }
const TTL = 30 * 1000;

export function invalidateTeacherClassroom() {
  cache = null;
}

export function getTeacherClassroom(userId) {
  if (!userId) return Promise.resolve(null);
  const now = Date.now();
  if (cache && cache.userId === userId && now - cache.ts < TTL) {
    return cache.promise;
  }
  const promise = base44.entities.Classroom
    .filter({ teacher_id: userId })
    .then((cr) => cr[0] || null);
  cache = { userId, promise, ts: now };
  promise.catch(() => {
    if (cache && cache.promise === promise) cache = null;
  });
  return promise;
}

let groupCache = null;
let memberCache = null;

export function invalidateClassroomContext() {
  groupCache = null;
  memberCache = null;
}

export function getClassroomGroups(classroomId) {
  if (!classroomId) return Promise.resolve([]);
  const now = Date.now();
  if (groupCache && groupCache.classroomId === classroomId && now - groupCache.ts < TTL) {
    return groupCache.promise;
  }
  const promise = base44.entities.Group.filter({ classroom_id: classroomId });
  groupCache = { classroomId, promise, ts: now };
  promise.catch(() => { if (groupCache && groupCache.promise === promise) groupCache = null; });
  return promise;
}

export function getClassroomMembers(classroomId) {
  if (!classroomId) return Promise.resolve([]);
  const now = Date.now();
  if (memberCache && memberCache.classroomId === classroomId && now - memberCache.ts < TTL) {
    return memberCache.promise;
  }
  const promise = base44.entities.GroupMember.filter({ classroom_id: classroomId });
  memberCache = { classroomId, promise, ts: now };
  promise.catch(() => { if (memberCache && memberCache.promise === promise) memberCache = null; });
  return promise;
}

let datasetCache = null;
const DATASET_TTL = 30 * 1000;

export function invalidateClassroomDataset() {
  datasetCache = null;
}

export function getClassroomDataset(classroomId) {
  if (!classroomId) return Promise.resolve(null);
  const now = Date.now();
  if (datasetCache && datasetCache.classroomId === classroomId && now - datasetCache.ts < DATASET_TTL) {
    return datasetCache.promise;
  }
  const promise = Promise.all([
    getClassroomGroups(classroomId),
    getClassroomMembers(classroomId),
    base44.entities.ClassSettings.filter({ classroom_id: classroomId }),
    base44.entities.GradingTerm.filter({ classroom_id: classroomId }),
    base44.entities.Attendance.filter({ classroom_id: classroomId }),
    base44.entities.ActivityScore.filter({ classroom_id: classroomId }),
    base44.entities.Activity.filter({ classroom_id: classroomId }),
    base44.entities.TeacherAssessment.filter({ classroom_id: classroomId }),
    base44.entities.ParticipationLog.filter({ classroom_id: classroomId }),
    base44.entities.GroupAccount.filter({ classroom_id: classroomId }),
    base44.entities.Mission.filter({ classroom_id: classroomId }),
    base44.entities.MissionSubmission.filter({ classroom_id: classroomId }),
    base44.entities.Reward.filter({ classroom_id: classroomId }),
    base44.entities.RewardRedemption.filter({ classroom_id: classroomId }),
    base44.entities.Badge.filter({ classroom_id: classroomId }),
    base44.entities.QRCode.filter({ classroom_id: classroomId }),
    base44.entities.Announcement.filter({ classroom_id: classroomId }),
  ]).then(([groups, members, settings, terms, attendance, scores, activities, assessments, logs, groupAccounts, missions, submissions, rewards, redemptions, badges, qrcodes, announcements]) => ({
    groups, members, settings, terms, attendance, scores, activities, assessments, logs, groupAccounts, missions, submissions, rewards, redemptions, badges, qrcodes, announcements,
  }));
  datasetCache = { classroomId, promise, ts: now };
  promise.catch(() => { if (datasetCache && datasetCache.promise === promise) datasetCache = null; });
  return promise;
}
