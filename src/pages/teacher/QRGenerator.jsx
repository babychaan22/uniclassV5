
const db = globalThis.__B44_DB__;

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { QrCode as QrIcon, Printer, Download, Loader2 } from "lucide-react";
import QRCode from "qrcode";

function genHash() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function TeacherQRGenerator() {
  const { user } = useAuth();
  const [classroom, setClassroom] = useState(null);
  const [form, setForm] = useState({ qr_type: "standard", base_points: 10, batch_size: 8 });
  const [generating, setGenerating] = useState(false);
  const [codes, setCodes] = useState([]);
  const [images, setImages] = useState({});

  useEffect(() => {
    async function load() {
      if (!user) return;
      const c = await getTeacherClassroom(user.id);
      setClassroom(c);
    }
    load();
  }, [user]);

  async function generate(e) {
    e.preventDefault();
    if (!classroom) return;
    setGenerating(true);
    const newCodes = [];
    for (let i = 0; i < form.batch_size; i++) {
      const hash = genHash();
      const created = await db.entities.QRCode.create({
        hash,
        classroom_id: classroom.id,
        qr_type: form.qr_type,
        base_points: Number(form.base_points),
        created_by: user.id,
      });
      newCodes.push(created);
    }
    setCodes(newCodes);
    const imgs = {};
    for (const c of newCodes) {
      imgs[c.id] = await QRCode.toDataURL(c.hash, { width: 200, margin: 1, color: { dark: "#000000", light: "#ffffff" } });
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
    a.href = url; a.download = `qr-codes-${classroom?.section || "class"}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (!classroom) return <div className="p-6 text-ink/60">Create a class first in Class Setup.</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1">QR Code Generator</h1>
        <p className="text-ink/60">{classroom.grade_level} · {classroom.section}</p>
      </div>

      <ClayCard className="p-6 no-print">
        <form onSubmit={generate} className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="font-display font-bold text-sm mb-1 block">Type</label>
            <select className="clay-input" value={form.qr_type} onChange={(e) => setForm({ ...form, qr_type: e.target.value })}>
              <option value="standard">Standard (fixed points)</option>
              <option value="gacha">Gacha (risk for multiplier)</option>
            </select>
          </div>
          <div>
            <label className="font-display font-bold text-sm mb-1 block">Base Points</label>
            <input type="number" min="1" className="clay-input" value={form.base_points} onChange={(e) => setForm({ ...form, base_points: e.target.value })} required />
          </div>
          <div>
            <label className="font-display font-bold text-sm mb-1 block">Batch Size</label>
            <input type="number" min="1" max="40" className="clay-input" value={form.batch_size} onChange={(e) => setForm({ ...form, batch_size: Number(e.target.value) })} required />
          </div>
          <div className="sm:col-span-3 flex flex-wrap gap-3">
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
          </div>
          <div className="clay-card p-4 bg-white">
            <div className="flex items-center justify-between border-b-2 border-ink pb-2 mb-4">
              <h2 className="font-display font-bold text-lg">{classroom.grade_level} - {classroom.section}</h2>
              <span className="font-mono text-sm">{form.qr_type.toUpperCase()} · {form.base_points}pts · {codes.length} codes</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {codes.map((c) => (
                <div key={c.id} className="border-2 border-black rounded-lg p-2 flex flex-col items-center">
                  {images[c.id] && <img src={images[c.id]} alt={c.hash} className="w-24 h-24" />}
                  <p className="font-mono text-[10px] mt-1 break-all text-center">{c.hash}</p>
                  <p className="font-display font-bold text-xs mt-0.5">{c.qr_type === "gacha" ? "GACHA" : `${c.base_points} PTS`}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
