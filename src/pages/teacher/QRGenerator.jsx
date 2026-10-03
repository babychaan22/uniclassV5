
const db = globalThis.__B44_DB__;

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/AuthContext";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import NovaMessage from "@/components/NovaMessage";
import { QrCode as QrIcon, Printer, Download, Loader2 } from "lucide-react";
import QRCode from "qrcode";

// 12 characters from a 36-symbol alphabet is about 62 bits. Drawn from the
// platform CSPRNG rather than Math.random, because these are the codes that
// hand out points.
function genHash() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

export default function TeacherQRGenerator() {
  const { user } = useAuth();
  const [form, setForm] = useState({ qr_type: "standard", base_points: 10, batch_size: 8 });
  const [generating, setGenerating] = useState(false);
  const [codes, setCodes] = useState([]);
  const [stored, setStored] = useState([]);
  const [images, setImages] = useState({});
  const [problem, setProblem] = useState("");

  // Every general code ever issued, so a new batch cannot repeat one. The
  // database has a unique index on hash as well; this is what makes that
  // guarantee visible before a write is attempted rather than as an error.
  const issued = useRef(new Set());

  async function loadStored() {
    if (!user) return;
    // Every generation is kept, so this is the full history rather than the
    // latest batch.
    const existing = await db.entities.QRCode.filter(
      { classroom_id: null },
      { columns: "id,hash,qr_type,base_points,created_date", orderBy: "created_date", ascending: false, limit: 500 },
    );
    const rows = existing || [];
    setStored(rows);
    issued.current = new Set(rows.map((row) => row.hash));
  }

  useEffect(() => {
    loadStored();
  }, [user]);

  // A code that is not already on record, however many tries it takes.
  function freshHash() {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const hash = genHash();
      if (!issued.current.has(hash)) return hash;
    }
    return null;
  }

  async function generate(e) {
    e.preventDefault();
    setGenerating(true);
    setProblem("");
    const newCodes = [];
    const batchSize = Math.max(1, Math.min(100, Math.floor(Number(form.batch_size) || 1)));
    setForm((current) => ({ ...current, batch_size: batchSize }));

    for (let i = 0; i < batchSize; i++) {
      const hash = freshHash();
      if (!hash) {
        setProblem("Could not find an unused code after 25 tries. Try again.");
        break;
      }
      // Reserved before the write, so two codes in one batch cannot collide
      // with each other either.
      issued.current.add(hash);
      const created = await db.entities.QRCode.create({
        hash,
        classroom_id: null,
        qr_type: form.qr_type,
        base_points: Number(form.base_points),
        created_by: user.id,
      });
      newCodes.push(created);
    }

    setCodes(newCodes);
    setStored((current) => [...newCodes, ...current]);
    const imgs = {};
    for (const c of newCodes) {
      imgs[c.id] = await QRCode.toDataURL(c.hash, { width: 360, margin: 2, color: { dark: "#000000", light: "#ffffff" } });
    }
    setImages(imgs);
    setGenerating(false);
  }

  function downloadCSV() {
    const rows = [["hash", "type", "base_points", "created_at"]];
    for (const c of codes) { rows.push([c.hash, c.qr_type, c.base_points, c.created_date]); }
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "uniclass-general-qr-codes.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="grid items-center gap-4 xl:grid-cols-[1fr_.8fr]">
        <div>
          <p className="mb-2 text-sm font-display font-bold text-clay-purple">Classroom tools</p>
          <h1 className="uc-page-title text-4xl leading-[.92]">QR Code Generator</h1>
          <p className="mt-3 text-sm text-ink/60">General codes · usable by any approved UniClass class · codes never expire</p>
        </div>
        <NovaMessage variant="idea" tone="pink" title="A quick class moment">
          Generate a batch, print it, and let each scan turn participation into progress.
        </NovaMessage>
      </div>

      {problem && (
        <p className="rounded-xl border-2 border-clay-coral/40 bg-clay-coral/10 p-3 text-sm font-bold text-clay-coral">{problem}</p>
      )}

      <ClayCard className="p-6 no-print">
        <form onSubmit={generate} className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,.8fr)_minmax(0,.8fr)]">
          <div className="min-w-0">
            <label className="font-display font-bold text-sm mb-1 block">Type</label>
            <select className="clay-input" value={form.qr_type} onChange={(e) => setForm({ ...form, qr_type: e.target.value })}>
              <option value="standard">Standard (fixed points)</option>
              <option value="gacha">Gacha (risk for multiplier)</option>
            </select>
          </div>
          <div className="min-w-0">
            <label className="font-display font-bold text-sm mb-1 block">Base Points</label>
            <input type="number" min="1" className="clay-input" value={form.base_points} onChange={(e) => setForm({ ...form, base_points: e.target.value })} required />
          </div>
          <div className="min-w-0">
            <label className="font-display font-bold text-sm mb-1 block">Batch Size</label>
            <input type="number" min="1" max="100" className="clay-input" value={form.batch_size} onChange={(e) => setForm({ ...form, batch_size: Number(e.target.value) })} required />
          </div>
          <div className="flex flex-wrap gap-3 xl:col-span-3">
            <ClayButton type="submit" color="pink" size="md" disabled={generating}>
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrIcon className="w-5 h-5" />}
              {generating ? "Generating..." : "Generate Batch"}
            </ClayButton>
            {form.qr_type === "gacha" && <ClayChip color="purple">Gacha: 0.5×–2× · 1.0× is most likely</ClayChip>}
          </div>
        </form>
      </ClayCard>

      {codes.length > 0 && (
        <div className="space-y-4">
          <div className="flex gap-3 no-print">
            <ClayButton color="sky" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print Sheet</ClayButton>
            <ClayButton color="lime" onClick={downloadCSV}><Download className="w-4 h-4" /> Download CSV</ClayButton>
            <ClayChip color="purple">Dense A4 · 70 per page · up to 100 per batch</ClayChip>
          </div>
          <div className="qr-print-sheet clay-card bg-white p-4">
            <div className="qr-print-header mb-4 flex items-center justify-between border-b-2 border-ink pb-2">
              <h2 className="font-display font-bold text-lg">General UniClass QR Codes</h2>
              <span className="font-mono text-sm">{form.qr_type.toUpperCase()} · {form.base_points} pts · {codes.length} codes · Scan once</span>
            </div>
            <div className="qr-code-grid grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {codes.map((c) => (
                <div key={c.id} className="qr-code-card flex flex-col items-center rounded-lg border-2 border-black p-2">
                  {images[c.id] && <img src={images[c.id]} alt={`QR code ${c.hash}`} className="h-24 w-24" />}
                  <p className="mt-1 break-all text-center font-mono text-[10px]">{c.hash}</p>
                  <p className="mt-0.5 font-display text-xs font-bold">{c.qr_type === "gacha" ? "GACHA" : `${c.base_points} PTS`}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {stored.length > 0 && (
        <ClayCard className="p-5 no-print">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display font-bold text-sm">
              Every code on record ({stored.length})
            </h2>
            <ClayChip color="lime">All unique · none expire</ClayChip>
          </div>
          <p className="mb-3 text-[11px] text-ink/60">
            Each generation is saved when it is created, so a code can never be issued twice.
          </p>
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {stored.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm">
                <span className="break-all font-mono text-xs">{c.hash}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <ClayChip color={c.qr_type === "gacha" ? "purple" : "sky"}>
                    {c.qr_type === "gacha" ? "Gacha" : `${c.base_points} pts`}
                  </ClayChip>
                  <span className="font-mono text-[10px] text-ink/40">
                    {c.created_date ? new Date(c.created_date).toLocaleString() : ""}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </ClayCard>
      )}
    </div>
  );
}
