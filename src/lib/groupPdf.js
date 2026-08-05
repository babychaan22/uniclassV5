
import { jsPDF } from "jspdf";

export function downloadGroupPdf({ classroom, term, group, groupRow, memberRows, attendance, scores, activities, todayStr }) {
  const doc = new jsPDF();
  let y = 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`UniClass - Group ${group.group_number} Report`, 14, y);
  y += 7;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${classroom.grade_level} - ${classroom.section} - SY ${classroom.school_year}`, 14, y);
  y += 6;
  doc.text(`Term: ${term ? `${term.term_label} (${term.start_date} to ${term.end_date})` : "none"}`, 14, y);
  y += 6;
  doc.text(`Generated: ${todayStr}`, 14, y);
  y += 9;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Group Standing: ${Math.round(groupRow.avgTotal)}% - ${groupRow.tag}`, 14, y);
  y += 9;

  doc.setFontSize(11);
  doc.text("Members", 14, y);
  y += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Name", 14, y);
  doc.text("Attend%", 95, y);
  doc.text("Activity%", 118, y);
  doc.text("Points", 150, y);
  doc.text("Total%", 170, y);
  doc.text("Status", 190, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  for (const r of memberRows) {
    if (y > 270) { doc.addPage(); y = 14; }
    doc.text(`${r.member.last_name}, ${r.member.first_name}`.slice(0, 30), 14, y);
    doc.text(String(Math.round(r.att.rate)), 97, y);
    doc.text(String(Math.round(r.act.pct)), 120, y);
    doc.text(String(Math.round(r.pts)), 152, y);
    doc.text(String(r.cls.total), 172, y);
    doc.text(r.cls.tag, 190, y);
    y += 5;
  }

  doc.save(`group-${group.group_number}-report.pdf`);
}

