import { useEffect, useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import { getStudentAccounts, ACTIVE_CLASSROOM_KEY, setActiveStudentClass } from '@/lib/studentContext';

export default function StudentClassSwitcher({ user }) {
  const [accounts, setAccounts] = useState([]);
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    let mounted = true;
    if (!user?.id) return undefined;
    getStudentAccounts(user.id).then((next) => {
      if (!mounted) return;
      setAccounts(next);
      const stored = window.localStorage.getItem(ACTIVE_CLASSROOM_KEY);
      setActiveId(next.some((account) => account.classroom_id === stored) ? stored : next[0]?.classroom_id || '');
    });
    return () => { mounted = false; };
  }, [user?.id]);

  if (accounts.length < 2) return null;

  const handleChange = (event) => {
    const classroomId = event.target.value;
    setActiveId(classroomId);
    setActiveStudentClass(classroomId);
    window.location.reload();
  };

  return (
    <label className="flex items-center gap-2 rounded-xl border-2 border-ink/20 bg-cream px-3 py-2 text-ink shadow-[2px_2px_0_rgba(23,22,43,0.2)]">
      <Layers className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">Active class</span>
      <select value={activeId} onChange={handleChange} className="min-w-0 max-w-[12rem] bg-transparent text-sm font-display font-extrabold outline-none">
        {accounts.map((account, index) => (
          <option key={account.id} value={account.classroom_id}>Class {index + 1}{account.is_representative ? ' · Representative' : ''}</option>
        ))}
      </select>
      <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
    </label>
  );
}
