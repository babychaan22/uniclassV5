import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { ROUTES } from '@/lib/routes';

const db = globalThis.__B44_DB__;

// Server-checked gate for teacher pages. The URL alone used to decide which
// workspace a signed-in user saw: a student following a shared /teacher link
// landed in a broken teacher shell. Here "teacher" is the RLS-protected fact
// that the user OWNS a classroom — a student's client-editable auth metadata
// never influences it. Note the real security boundary remains RLS; a student
// in the teacher UI could never read another class's data anyway. This guard
// fixes the wrong-audience UX.
//
// Network failures fail open (the page renders; RLS still protects data):
// bouncing teachers to the login flow over one flaky request is worse than
// showing their own workspace a second late. The status is cached per user
// for the session so each navigation does not re-query.

const RESOLVES = new Map(); // user_id -> { role, at }
const CACHE_TTL_MS = 5 * 60 * 1000; // re-check after 5 minutes; roles can change (new classroom, roster removal)

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay-purple border-t-transparent" />
    </div>
  );
}

async function resolveRole(userId) {
  const cached = RESOLVES.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.role;
  const promise = (async () => {
    const classrooms = await db.entities.Classroom.filter({ teacher_id: userId }, { limit: 1 });
    if (classrooms.length > 0) return 'teacher';
    const accounts = await db.entities.GroupAccount.filter({ user_id: userId }, { limit: 1 });
    if (accounts.length > 0) return 'student';
    return 'new';
  })();
  // Only settled stable roles are cached; a 'new' user could create a
  // classroom moments later, so they are always re-checked.
  promise.then((role) => {
    if (role === 'teacher' || role === 'student') RESOLVES.set(userId, { role, at: Date.now() });
  }).catch(() => {});
  return promise;
}

export default function TeacherRouteGuard() {
  const { user } = useAuth();
  const [status, setStatus] = useState(() => {
    const cached = user && RESOLVES.get(user.id);
    return (cached && Date.now() - cached.at < CACHE_TTL_MS) ? cached.role : 'loading';
  });
  const requestId = useRef(0);

  useEffect(() => {
    if (!user) return undefined;
    const id = ++requestId.current;
    resolveRole(user.id)
      .then((role) => { if (id === requestId.current) setStatus(role); })
      .catch(() => { if (id === requestId.current) setStatus('teacher'); });
    return () => { requestId.current += 1; };
  }, [user?.id]);

  if (!user) return <PageLoader />;
  if (status === 'loading') return <PageLoader />;

  // Students land in their own workspace; users without any account or
  // classroom go to the join flow, where they can pick their side.
  if (status === 'student') return <Navigate to={ROUTES.STUDENT.DASHBOARD} replace />;
  if (status !== 'teacher') return <Navigate to={ROUTES.STUDENT.ONBOARDING} replace />;

  return <Outlet />;
}
