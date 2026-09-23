
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getClassroomGroups, getClassroomMembers } from "@/lib/teacherClassroom";

import Papa from "papaparse";
import Nova from "@/components/mascot/Nova";
import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import NovaMessage from "@/components/NovaMessage";
import { Upload, Download, Loader2, CheckCircle2 } from "lucide-react";
import { ROUTES } from '@/lib/routes';

const TEMPLATE_HEADERS = ["group_number", "last_name", "first_name", "category", "item_label", "score", "max_score"];
const CATEGORIES = ["quiz", "major_exam", "performance_task"];

/**
 * Parse a score-import CSV entirely client-side (no backend round-trip).
 * Expects headers matching TEMPLATE_HEADERS (see downloadTemplate()).
 * Replaces the old Base44 UploadFile + ExtractDataFromUploadedFile flow.
 */
function parseScoreCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (results) => {
        if (results.errors?.length) {
          reject(new Error(results.errors[0].message || "Could not parse CSV file."));
          return;
        }
        const rows = results.data.map((r) => ({
          group_number: Number(r.group_number),
          last_name: r.last_name,
          first_name: r.first_name,
          category: r.category,
          item_label: r.item_label,
          score: Number(r.score),
          max_score: Number(r.max_score),
        }));
        resolve(rows);
      },
      error: (err) => reject(err),
    });
  });
}

export default function ScoreImport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classrooms, setClassrooms] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [loadingClass, setLoadingClass] = useState(true);

  useEffect(() => { loadClassrooms(); }, [user]);

  async function loadClassrooms() {
    if (!user) return;
    const cr = await db.entities.Classroom.filter({ teacher_id: user.id });
    cr.sort((a, b) => (b.created_date || "").localeCompare(a.created_date || ""));
    setClassrooms(cr);
    if (cr.length === 0) { setLoadingClass(false); navigate(ROUTES.TEACHER.ONBOARDING); return; }
    const last = cr[0];
    setSelectedId(last.id);
    await loadClass(last.id);
  }

  async function loadClass(classroomId) {
    setLoadingClass(true);
    const [g, m] = await Promise.all([
      getClassroomGroups(classroomId),
      getClassroomMembers(classroomId),
    ]);
    setGroups(g.sort((a, b) => a.group_number - b.group_number));
    setMembers(m);
    setLoadingClass(false);
  }

  function onChangeClass(e) {
    const id = e.target.value;
    setSelectedId(id);
    setResult(null);
    loadClass(id);
  }

  const selectedClassroom = classrooms.find((c) => c.id === selectedId) || null;

  function downloadTemplate() {
    const gmap = Object.fromEntries(groups.map((g) => [g.id, g.group_number]));
    const rows = members.map((m) => [gmap[m.group_id] ?? "", m.last_name, m.first_name, "", "", "", ""]);
    const csv = [TEMPLATE_HEADERS.join(","), ...rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `score-template-${selectedClassroom?.grade_level || "class"}-${selectedClassroom?.section || ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const rows = await parseScoreCsv(file);
      const norm = (s) => (s || "").toString().toUpperCase().trim();
      let ok = 0, fail = 0;
      const toCreate = [];
      for (const r of rows) {
        const mem = members.find((m) =>
          groups.find((g) => g.id === m.group_id)?.group_number === Number(r.group_number) &&
          norm(m.last_name) === norm(r.last_name) && norm(m.first_name) === norm(r.first_name)
        );
        if (!mem) { fail++; continue; }
        toCreate.push({
          group_member_id: mem.id,
          group_id: mem.group_id,
          classroom_id: selectedId,
          category: CATEGORIES.includes(String(r.category).toLowerCase()) ? String(r.category).toLowerCase() : "quiz",
          item_label: String(r.item_label || ""),
          score: Number(r.score) || 0,
          max_score: Number(r.max_score) || 0,
          encoded_by: user.id,
        });
        ok++;
      }
      if (toCreate.length) await db.entities.TeacherAssessment.bulkCreate(toCreate);
      setResult({ ok, fail });
    } catch (err) {
      setResult({ ok: 0, fail: 0, error: err.message || "Import failed" });
    }
    setBusy(false);
  }

  if (loadingClass && !selectedClassroom) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
        <div><p className="mb-1 text-sm font-display font-bold text-clay-purple">Assessment tools</p><h1 className="text-3xl font-display font-extrabold tracking-tight sm:text-4xl flex items-center gap-2"><Upload className="w-7 h-7" /> Import scores</h1><p className="mt-2 text-ink/60 text-sm sm:text-base">Pick a class, download a prefilled CSV template, then upload the filled scores.</p></div>
        <NovaMessage variant="idea" title="Bring scores in quickly" tone="blue">Your template already includes the students in the selected class.</NovaMessage>
      </div>

      <div className="grid gap-4 lg:grid-cols-[.95fr_1.05fr]">
      <ClayCard className="p-5">
        <div className="mb-4 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-clay-purple text-sm font-display font-bold text-white">1</span><div><h2 className="font-display font-bold text-lg">Select class</h2><p className="text-xs text-ink/55">Choose the roster for this import.</p></div></div>
        <label className="font-display font-bold text-xs mb-1 block">Class</label>
        <select className="clay-input" value={selectedId} onChange={onChangeClass}>
          {classrooms.map((c) => <option key={c.id} value={c.id}>{c.grade_level} · {c.section}{c.subject ? ` · ${c.subject}` : ""}</option>)}
        </select>
        {selectedClassroom && (
          <div className="flex flex-wrap gap-2 mt-3">
            <ClayChip color="sky">{selectedClassroom.grade_level} · {selectedClassroom.section}</ClayChip>
            <ClayChip color="cream">{members.length} students</ClayChip>
            <ClayChip color="cream">{groups.length} groups</ClayChip>
          </div>
        )}
      </ClayCard>

      <ClayCard className="p-5">
        <div className="mb-4 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-clay-sky text-sm font-display font-bold text-white">2</span><div><h2 className="font-display font-bold text-lg">Download template</h2><p className="text-xs text-ink/55">Use the prepared file for this class.</p></div></div>
        <p className="text-xs text-ink/60 mb-3">Columns: {TEMPLATE_HEADERS.join(", ")}. Categories: {CATEGORIES.join(", ")}. Student rows are prefilled — fill the last 4 columns.</p>
        <ClayButton color="sky" size="sm" onClick={downloadTemplate} disabled={!selectedId || members.length === 0}>
          <Download className="w-4 h-4" /> Download CSV Template
        </ClayButton>
      </ClayCard>

      <ClayCard className="p-5 lg:col-span-2">
        <div className="mb-4 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-clay-lime text-sm font-display font-bold text-ink">3</span><div><h2 className="font-display font-bold text-lg">Upload completed file</h2><p className="text-xs text-ink/55">We match each score to the current roster.</p></div></div>
        <input type="file" accept=".csv" onChange={handleFile} disabled={busy || !selectedId} className="clay-input p-2" />
        {busy && <p className="text-xs text-ink/60 mt-2 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Processing...</p>}
        {result && (
          <div className="mt-3">
            {result.error ? (
              <ClayChip color="coral">{result.error}</ClayChip>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-[rgba(16,32,101,.08)] bg-clay-lime/5 p-3">
                <Nova variant="celebrate" size="sm" className="h-10 w-10" />
                <div className="flex gap-2">
                  <ClayChip color="lime"><CheckCircle2 className="w-3 h-3" /> {result.ok} imported</ClayChip>
                  {result.fail > 0 && <ClayChip color="coral">{result.fail} unmatched</ClayChip>}
                </div>
              </div>
            )}
          </div>
        )}
      </ClayCard>
      </div>
    </div>
  );
}
