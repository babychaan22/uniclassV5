import { useEffect, useState } from 'react';
import { Layers, ChevronDown } from 'lucide-react';
import {
  ACTIVE_TEACHER_CLASSROOM_KEY,
  getTeacherClassrooms,
  setActiveTeacherClassroom,
} from '@/lib/teacherClassroom';

export default function TeacherClassSwitcher({ user }) {
  const [classrooms, setClassrooms] = useState([]);
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    let mounted = true;
    if (!user?.id) return undefined;
    getTeacherClassrooms(user.id).then((next) => {
      if (!mounted) return;
      setClassrooms(next);
      const stored = window.localStorage.getItem(ACTIVE_TEACHER_CLASSROOM_KEY);
      setActiveId(next.some((classroom) => classroom.id === stored) ? stored : next[0]?.id || '');
    });
    return () => { mounted = false; };
  }, [user?.id]);

  if (classrooms.length < 2) return null;

  function handleChange(event) {
    const classroomId = event.target.value;
    setActiveId(classroomId);
    setActiveTeacherClassroom(classroomId);
    window.location.reload();
  }

  return (
    <label className="flex items-center gap-2 rounded-xl border-2 border-ink/20 bg-cream px-3 py-2 text-ink shadow-[2px_2px_0_rgba(23,22,43,0.2)]">
      <Layers className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">Active class</span>
      <select aria-label="Active class" value={activeId} onChange={handleChange} className="min-w-0 max-w-[13rem] bg-transparent text-sm font-display font-extrabold outline-none">
        {classrooms.map((classroom) => (
          <option key={classroom.id} value={classroom.id}>
            {classroom.grade_level} · {classroom.section}{classroom.subject ? ` · ${classroom.subject}` : ''}
          </option>
        ))}
      </select>
      <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
    </label>
  );
}
