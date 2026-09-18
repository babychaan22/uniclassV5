import { useEffect, useState } from 'react';
import { Cloud, CloudOff } from 'lucide-react';

export default function OfflineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOffline = () => { setOnline(false); setWasOffline(true); };
    const handleOnline = () => { setOnline(true); };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  useEffect(() => {
    if (!online || !wasOffline) return undefined;
    const timer = window.setTimeout(() => window.location.reload(), 700);
    return () => window.clearTimeout(timer);
  }, [online, wasOffline]);

  if (online && !wasOffline) return null;
  return (
    <div className={`fixed bottom-3 left-3 right-3 z-[70] mx-auto max-w-md rounded-2xl border-2 border-ink px-3 py-2 text-xs font-display font-bold shadow-[3px_3px_0_#17162B] ${online ? 'bg-clay-lime text-ink' : 'bg-clay-sun text-ink'}`} role="status">
      {online ? <Cloud className="mr-1 inline h-4 w-4" /> : <CloudOff className="mr-1 inline h-4 w-4" />}
      {online ? 'Back online — refreshing your data…' : 'Offline — opened pages stay available. Reconnect before scanning, uploading, or saving points.'}
    </div>
  );
}
