import { useEffect, useState } from 'react';
const db = globalThis.__B44_DB__;

export const ACTIVE_CLASSROOM_KEY = 'uniclass.activeClassroomId';
export const ACTIVE_CLASS_CHANGED_EVENT = 'uniclass-active-class-changed';

const ACCOUNT_FIELDS = [
  'id',
  'classroom_id',
  'group_id',
  'group_member_id',
  'user_id',
  'first_name',
  'last_name',
  'email',
  'is_approved',
  'is_representative',
].join(',');

export async function getStudentAccounts(userId) {
  if (!userId) return [];
  const accounts = await db.entities.GroupAccount.filter(
    { user_id: userId },
    { columns: ACCOUNT_FIELDS }
  );
  return (accounts || []).filter((account) => account.is_approved !== false);
}

export async function getActiveStudentAccount(userId) {
  const accounts = await getStudentAccounts(userId);
  if (!accounts.length) return null;

  const activeClassroomId = typeof window !== 'undefined'
    ? window.localStorage.getItem(ACTIVE_CLASSROOM_KEY)
    : null;

  return accounts.find((account) => account.classroom_id === activeClassroomId) || accounts[0];
}

export function setActiveStudentClass(classroomId) {
  if (typeof window === 'undefined') return;
  if (classroomId) window.localStorage.setItem(ACTIVE_CLASSROOM_KEY, classroomId);
  else window.localStorage.removeItem(ACTIVE_CLASSROOM_KEY);
  window.dispatchEvent(new CustomEvent(ACTIVE_CLASS_CHANGED_EVENT, { detail: { classroomId } }));
}

export function useActiveStudentAccount(userId) {
  const [account, setAccount] = useState(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const nextAccount = await getActiveStudentAccount(userId);
      if (mounted) setAccount(nextAccount);
    };

    load();
    const handleChange = () => load();
    window.addEventListener(ACTIVE_CLASS_CHANGED_EVENT, handleChange);
    return () => {
      mounted = false;
      window.removeEventListener(ACTIVE_CLASS_CHANGED_EVENT, handleChange);
    };
  }, [userId]);

  return account;
}
