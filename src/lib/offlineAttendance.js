// Offline attendance queue (audit #3).
//
// Teachers take attendance on spotty school Wi-Fi, often at the start of
// class. Until now a save that happened while the device was offline was
// simply lost with an error banner. This module queues those writes in
// localStorage and replays them in order when connectivity returns.
//
// Scope is deliberately narrow: attendance is append-mostly, keyed by
// (group_member_id, attendance_date), and written only by the teacher or a
// representative, so a simple ordered replay is safe. Creates that collide
// with a row created meanwhile by another device are repaired into updates,
// mirroring the 23505 recovery path already in teacher/Attendance.jsx.

import { supabase } from '@/api/supabaseClient';

const QUEUE_KEY = 'uniclass.offline.attendance.v1';
const MAX_QUEUE = 200;

// Fired whenever the queued count changes so UI (OfflineStatus, roster)
// can keep its "waiting to sync" hints fresh.
export const ATTENDANCE_QUEUE_EVENT = 'uniclass-offline-queue-updated';

/** Reads the queued writes, oldest first. Never throws. */
export function readAttendanceQueue() {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(entries) {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(entries.slice(-MAX_QUEUE)));
  } catch { /* storage full or blocked: the write will retry on the next save */ }
  try {
    window.dispatchEvent(new CustomEvent(ATTENDANCE_QUEUE_EVENT, { detail: { count: entries.length } }));
  } catch { /* non-DOM context (tests) */ }
}

/**
 * Decide whether an error means "the device/network was down" rather than
 * a real data problem. A network failure must be retried, never dropped.
 */
export function isOfflineNetworkError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message = String(error?.message ?? error ?? '');
  return error?.name === 'TypeError' || /failed to fetch|fetch failed|network error|network request failed|load failed|timed?\s?out/i.test(message);
}

/**
 * Queue one attendance write for later replay.
 * entry: { kind: 'create'|'update', id?: uuid, payload: {...} }
 */
export function enqueueAttendanceWrite(entry) {
  const queued = readAttendanceQueue();
  queued.push({ ...entry, queuedAt: new Date().toISOString() });
  writeQueue(queued);
  return queued.length;
}

/** Replay the queued writes against Supabase. Kept simple on purpose. */
export async function flushAttendanceQueue() {
  const entries = readAttendanceQueue();
  if (!entries.length) return { flushed: 0, failed: 0, remaining: [] };

  const remaining = [];
  let flushed = 0;
  for (const entry of entries) {
    try {
      await applyAttendanceWrite(entry);
      flushed += 1;
    } catch (error) {
      // Offline errors stop the replay in order and keep everything after
      // them queued. Any other error suggests a data problem: keep the write
      // queued so a retry on the roster page (or a later flush) can resolve
      // it, but do not block the writes behind it.
      remaining.push(entry);
      if (isOfflineNetworkError(error)) break;
    }
  }

  writeQueue(remaining);
  return { flushed, failed: remaining.length, remaining };
}

async function applyAttendanceWrite(entry) {
  if (!entry || !entry.payload) throw new Error('Malformed queued attendance write.');
  if (entry.kind === 'update' && entry.id) {
    const { data, error } = await supabase
      .from('attendances')
      .update(entry.payload)
      .eq('id', entry.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('attendances')
    .insert(entry.payload)
    .select()
    .single();
  if (!error) return data;

  // Another device created the row in the offline gap. Repair the same way
  // the online path does: adopt that row and apply the teacher's status.
  if (error.code === '23505') {
    const match = await supabase
      .from('attendances')
      .select('id')
      .eq('group_member_id', entry.payload.group_member_id)
      .eq('attendance_date', entry.payload.attendance_date)
      .limit(1);
    if (match.data?.[0]) {
      const repaired = await supabase
        .from('attendances')
        .update({
          classroom_id: entry.payload.classroom_id,
          group_id: entry.payload.group_id,
          status: entry.payload.status,
          marked_by: entry.payload.marked_by,
        })
        .eq('id', match.data[0].id)
        .select()
        .single();
      if (repaired.error) throw repaired.error;
      return repaired.data;
    }
  }
  throw error;
}
