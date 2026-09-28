import { createContext, useContext, useEffect, useState } from "react";
import { db, invalidateEntityCache } from "@/api/supabaseClient";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { getTeacherClassroom } from "@/lib/teacherClassroom";

const GroupBadgeContext = createContext({ badges: [], definitions: [], now: new Date() });
export const GROUP_BADGES_UPDATED_EVENT = "uniclass:group-badges-updated";

export function notifyGroupBadgesUpdated() {
  if (typeof window !== "undefined") {
    invalidateEntityCache("Badge");
    invalidateEntityCache("ParticipationLog");
    window.dispatchEvent(new Event(GROUP_BADGES_UPDATED_EVENT));
  }
}

export function GroupBadgeProvider({ children, user, isTeacher, locationKey }) {
  const [badgeData, setBadgeData] = useState({ badges: [], definitions: [] });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user?.id) {
        setBadgeData({ badges: [], definitions: [] });
        return;
      }
      try {
        const classroom = isTeacher
          ? await getTeacherClassroom(user.id)
          : await (async () => {
              const account = await getActiveStudentAccount(user.id);
              if (!account) return null;
              const group = await db.entities.Group.get(account.group_id);
              return { id: group.classroom_id };
            })();
        if (!classroom) {
          if (!cancelled) setBadgeData({ badges: [], definitions: [] });
          return;
        }
        const [badges, definitions] = await Promise.all([
          db.entities.Badge.filter({ classroom_id: classroom.id }),
          db.entities.BadgeDefinition.filter(isTeacher ? { created_by: user.id } : { is_active: true }),
        ]);
        if (!cancelled) setBadgeData({ badges, definitions });
      } catch {
        if (!cancelled) setBadgeData({ badges: [], definitions: [] });
      }
    }
    load();
    window.addEventListener(GROUP_BADGES_UPDATED_EVENT, load);
    window.addEventListener("uniclass-student-class-changed", load);
    window.addEventListener("uniclass-teacher-class-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener(GROUP_BADGES_UPDATED_EVENT, load);
      window.removeEventListener("uniclass-student-class-changed", load);
      window.removeEventListener("uniclass-teacher-class-changed", load);
    };
  }, [user?.id, isTeacher, locationKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return <GroupBadgeContext.Provider value={{ ...badgeData, now }}>{children}</GroupBadgeContext.Provider>;
}

export function useGroupBadgeData() {
  return useContext(GroupBadgeContext);
}
