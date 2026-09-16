
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import { Download, FileText, Loader2 } from "lucide-react";
import { ROUTES } from '@/lib/routes';

function downloadCSV(name, headers, rows) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function ExportData() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    const ds = await getClassroomDataset(c.id, ['groups', 'members', 'attendance', 'assessments', 'missions', 'submissions']);
    const { members, groups, attendance, missions } = ds;
    const scores = ds.assessments;
    const subs = ds.submissions;
    const gmap = Object.fromEntries(groups.map((g) => [g.id, g.group_number]));
    const mmap = Object.fromEntries(members.map((m) => [m.id, `G${gmap[m.group_id] ?? "?"} ${m.last_name}, ${m.first_name}`]));
    const mimap = Object.fromEntries(missions.map((m) => [m.id, m.title]));
    setData({ c, gmap, mmap, scores, attendance, subs, mimap });
    setLoading(false);
  }

  function scoresCSV() {
    downloadCSV("scores.csv", ["Student", "Category", "Item", "Score", "Max"],
      data.scores.map((s) => [data.mmap[s.group_member_id] || "—", s.category, s.item_label, s.score, s.max_score]));
  }
  function attCSV() {
    downloadCSV("attendance.csv", ["Student", "Date", "Status"],
      data.attendance.map((a) => [data.mmap[a.group_member_id] || "—", a.attendance_date, a.status]));
  }
  function missionsCSV() {
    downloadCSV("missions.csv", ["Student", "Mission", "Score", "XP", "Graded By"],
      data.subs.map((s) => [data.mmap[s.group_id] || "Group", data.mimap[s.mission_id] || "—", s.score, s.xp_earned, s.graded_by || ""]));
  }

  async function exportPDF() {
    setBusy("pdf");
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(`${data.c.grade_level} ${data.c.section} — Class Report`, 14, 18);
    doc.setFontSize(10);
    doc.text(`Generated ${new Date().toLocaleString()}`, 14, 26);
    let y = 36;
    doc.setFontSize(13); doc.text("Scores", 14, y); y += 6;
    doc.setFontSize(9);
    data.scores.slice(0, 40).forEach((s) => {
      doc.text(`${data.mmap[s.group_member_id] || "—"} | ${s.category} | ${s.item_label} | ${s.score}/${s.max_score}`, 14, y); y += 5;
      if (y > 280) { doc.addPage(); y = 16; }
    });
    y += 4; doc.setFontSize(13); doc.text("Attendance", 14, y); y += 6; doc.setFontSize(9);
    data.attendance.slice(0, 40).forEach((a) => {
      doc.text(`${data.mmap[a.group_member_id] || "—"} | ${a.attendance_date} | ${a.status}`, 14, y); y += 5;
      if (y > 280) { doc.addPage(); y = 16; }
    });
    y += 4; doc.setFontSize(13); doc.text("Mission Submissions", 14, y); y += 6; doc.setFontSize(9);
    data.subs.slice(0, 40).forEach((s) => {
      doc.text(`${data.mimap[s.mission_id] || "—"} | ${data.mmap[s.group_id] || "Group"} | ${s.score} → ${s.xp_earned} XP`, 14, y); y += 5;
      if (y > 280) { doc.addPage(); y = 16; }
    });
    doc.save("class-report.pdf");
    setBusy(null);
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><Download className="w-6 h-6" /> Data Export</h1>
        <p className="text-ink/60 text-sm">Download CSV or PDF reports of scores, attendance, and mission history.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <ClayCard className="p-4 text-center">
          <FileText className="w-6 h-6 mx-auto text-clay-purple mb-2" />
          <p className="font-display font-bold text-sm mb-3">Scores CSV</p>
          <ClayButton color="sky" size="sm" className="w-full" onClick={scoresCSV}><Download className="w-4 h-4" /> Download</ClayButton>
        </ClayCard>
        <ClayCard className="p-4 text-center">
          <FileText className="w-6 h-6 mx-auto text-clay-sky mb-2" />
          <p className="font-display font-bold text-sm mb-3">Attendance CSV</p>
          <ClayButton color="sky" size="sm" className="w-full" onClick={attCSV}><Download className="w-4 h-4" /> Download</ClayButton>
        </ClayCard>
        <ClayCard className="p-4 text-center">
          <FileText className="w-6 h-6 mx-auto text-clay-lime mb-2" />
          <p className="font-display font-bold text-sm mb-3">Missions CSV</p>
          <ClayButton color="sky" size="sm" className="w-full" onClick={missionsCSV}><Download className="w-4 h-4" /> Download</ClayButton>
        </ClayCard>
        <ClayCard className="p-4 text-center">
          <FileText className="w-6 h-6 mx-auto text-clay-coral mb-2" />
          <p className="font-display font-bold text-sm mb-3">PDF Report</p>
          <ClayButton color="coral" size="sm" className="w-full" onClick={exportPDF} disabled={busy === "pdf"}>
            {busy === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download
          </ClayButton>
        </ClayCard>
      </div>
    </div>
  );
}
