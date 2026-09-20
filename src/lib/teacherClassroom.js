// Only the import line changes — the entire caching logic is identical.
import { db as base44 } from "@/api/supabaseClient";

// Module-level cache for the current teacher's classroom record.
let cache = null; // { userId, promise, ts }
export const ACTIVE_TEACHER_CLASSROOM_KEY = 'uniclass.teacher.activeClassroomId';
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
    .then((cr) => {
      if (!cr?.length) return null;
      const selected = typeof window !== 'undefined'
        ? window.localStorage.getItem(ACTIVE_TEACHER_CLASSROOM_KEY)
        : null;
      return cr.find((classroom) => classroom.id === selected) || cr[0];
    });
  cache = { userId, promise, ts: now };
  promise.catch(() => {
    if (cache && cache.promise === promise) cache = null;
  });
  return promise;
}

export function getTeacherClassrooms(userId) {
  if (!userId) return Promise.resolve([]);
  return base44.entities.Classroom.filter({ teacher_id: userId });
}

export function setActiveTeacherClassroom(classroomId) {
  if (typeof window === 'undefined') return;
  if (classroomId) window.localStorage.setItem(ACTIVE_TEACHER_CLASSROOM_KEY, classroomId);
  else window.localStorage.removeItem(ACTIVE_TEACHER_CLASSROOM_KEY);
  window.dispatchEvent(new CustomEvent('uniclass-teacher-class-changed', { detail: { classroomId } }));
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

const datasetCache = new Map();
const DATASET_TTL = 30 * 1000;

export function invalidateClassroomDataset() {
  datasetCache.clear();
}

const DATASET_QUERIES = {
  settings: (id) => base44.entities.ClassSettings.filter({ classroom_id: id }, { columns: 'id,classroom_id,weight_attendance,weight_activity_scores,weight_quizzes,weight_major_exams,weight_performance_tasks,weight_participation' }),
  terms: (id) => base44.entities.GradingTerm.filter({ classroom_id: id }, { columns: 'id,classroom_id,term_label,start_date,end_date,is_active' }),
  attendance: (id) => base44.entities.Attendance.filter({ classroom_id: id }, { columns: 'id,classroom_id,group_id,group_member_id,attendance_date,status,marked_by' }),
  scores: (id) => base44.entities.ActivityScore.filter({ classroom_id: id }, { columns: 'id,classroom_id,group_id,group_member_id,activity_id,score,encoded_by' }),
  activities: (id) => base44.entities.Activity.filter({ classroom_id: id }, { columns: 'id,classroom_id,activity_number,title,max_score,week_label' }),
  assessments: (id) => base44.entities.TeacherAssessment.filter({ classroom_id: id }, { columns: 'id,classroom_id,group_id,group_member_id,category,item_label,score,max_score,encoded_by' }),
  logs: (id) => base44.entities.ParticipationLog.filter({ classroom_id: id }, { columns: 'id,created_date,classroom_id,group_id,group_member_id,recipient_type,qr_code_id,points_awarded,xp_spent,event_type,multiplier,note', orderBy: 'created_date', ascending: false }),
  groupAccounts: (id) => base44.entities.GroupAccount.filter({ classroom_id: id }, { columns: 'id,classroom_id,group_id,group_member_id,user_id,last_name,first_name,email,is_approved,is_representative' }),
  missions: (id) => base44.entities.Mission.filter({ classroom_id: id }, { columns: 'id,created_date,classroom_id,title,description,xp_reward,max_score,deadline,is_active,created_by,formative_type,ai_content,answer_key' }),
  submissions: (id) => base44.entities.MissionSubmission.filter({ classroom_id: id }, { columns: 'id,created_date,mission_id,group_id,group_member_id,classroom_id,score,xp_earned,graded_by,answers', orderBy: 'created_date', ascending: false }),
  rewards: (id) => base44.entities.Reward.filter({ classroom_id: id }, { columns: 'id,classroom_id,title,description,emoji,cost_points,is_active,created_by,applies_to_all_classes' }),
  redemptions: (id) => base44.entities.RewardRedemption.filter({ classroom_id: id }, { columns: 'id,created_date,reward_id,reward_title,group_id,classroom_id,points_spent,redeemed_by,approval_status,reviewed_by,reviewed_at', orderBy: 'created_date', ascending: false }),
  badges: (id) => base44.entities.Badge.filter({ classroom_id: id }, { columns: 'id,created_date,group_id,classroom_id,badge_type,week_start_date,points_awarded,redeemed_by,badge_definition_id,member_id,approval_status,reviewed_by,reviewed_at' }),
  qrcodes: (id) => base44.entities.QRCode.filter({ classroom_id: id }, { columns: 'id,created_date,hash,classroom_id,qr_type,base_points,is_used,used_by_member_id,used_at,created_by', orderBy: 'created_date', ascending: false }),
  announcements: (id) => base44.entities.Announcement.filter({ classroom_id: id }, { columns: 'id,created_date,classroom_id,title,body,is_pinned,created_by', orderBy: 'created_date', ascending: false }),
};

export function getClassroomDataset(classroomId, requested = Object.keys(DATASET_QUERIES)) {
  if (!classroomId) return Promise.resolve(null);
  const now = Date.now();
  const keys = [...new Set(requested)].filter((key) => DATASET_QUERIES[key] || key === 'groups' || key === 'members').sort();
  const cacheKey = keys.join(',');
  const cached = datasetCache.get(`${classroomId}:${cacheKey}`);
  if (cached && now - cached.ts < DATASET_TTL) {
    return cached.promise;
  }
  const promise = Promise.all(keys.map((key) => key === 'groups' ? getClassroomGroups(classroomId) : key === 'members' ? getClassroomMembers(classroomId) : DATASET_QUERIES[key](classroomId)))
    .then((values) => Object.fromEntries(keys.map((key, index) => [key, values[index]])));
  const cacheEntry = { promise, ts: now };
  datasetCache.set(`${classroomId}:${cacheKey}`, cacheEntry);
  promise.catch(() => { if (datasetCache.get(`${classroomId}:${cacheKey}`)?.promise === promise) datasetCache.delete(`${classroomId}:${cacheKey}`); });
  return promise;
}
