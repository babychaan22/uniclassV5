import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ZoomIn } from 'lucide-react';

export default function MissionImage({ src, alt, className = '' }) {
  if (!src) return null;
  return <Dialog>
    <DialogTrigger asChild>
      <button type="button" className={`relative block w-full text-left ${className}`} aria-label={`Enlarge ${alt}`}>
        <img src={src} alt={alt} className="max-h-72 w-full rounded-xl border-2 border-ink bg-white object-contain" loading="lazy" />
        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-ink/85 px-2 py-1 text-xs font-bold text-white"><ZoomIn className="h-4 w-4" /> Tap to enlarge</span>
      </button>
    </DialogTrigger>
    <DialogContent className="max-w-4xl rounded-2xl bg-white p-4 pt-10">
      <DialogTitle className="sr-only">{alt}</DialogTitle>
      <DialogDescription className="sr-only">Enlarged mission image. Close to return to the mission.</DialogDescription>
      <div className="max-h-[75dvh] overflow-auto"><img src={src} alt={alt} className="mx-auto h-auto max-w-full object-contain" /></div>
    </DialogContent>
  </Dialog>;
}
