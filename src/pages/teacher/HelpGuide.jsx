
import ClayCard from "@/components/ClayCard";
import { HelpCircle, Dices, Target, BarChart3 } from "lucide-react";

export default function HelpGuide() {
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><HelpCircle className="w-6 h-6" /> Teacher Help Guide</h1>
        <p className="text-ink/60 text-sm">How the gacha, missions, and analytics work in UniClass.</p>
      </div>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-lg mb-2 flex items-center gap-2"><Dices className="w-5 h-5" /> Gacha &amp; Tambiolo</h2>
        <ul className="list-disc list-inside space-y-1 text-sm text-ink/80">
          <li>Generate <b>gacha-type</b> QR codes from the QR Generator to add risk-reward spins.</li>
          <li>When a student scans a gacha code, they choose to keep points safe or risk them for a 0.5×–2× multiplier. The 1.0× result is most likely.</li>
          <li>The <b>Tambiolo</b> tumbles balls labelled with each multiplier — slow, then fast, then slow — and the winning ball settles as the result.</li>
          <li>Outcomes use equal odds, so over time rewards stay fair while keeping things exciting.</li>
        </ul>
      </ClayCard>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-lg mb-2 flex items-center gap-2"><Target className="w-5 h-5" /> Managing Missions</h2>
        <ul className="list-disc list-inside space-y-1 text-sm text-ink/80">
          <li>Create missions as <b>manual</b> (you grade) or AI-generated true/false, multiple-choice, or drag-and-drop.</li>
          <li>Enter a topic and pick a quiz type, then tap <b>Generate with AI</b> to build the assessment.</li>
          <li>Students submit answers and the AI grades them automatically, converting the score into XP.</li>
          <li>Toggle a mission active so students can see it; use the inline <b>Grade</b> button for manual scoring.</li>
        </ul>
      </ClayCard>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-lg mb-2 flex items-center gap-2"><BarChart3 className="w-5 h-5" /> Reading Analytics</h2>
        <ul className="list-disc list-inside space-y-1 text-sm text-ink/80">
          <li>The <b>Weekly Attendance Rate</b> line chart shows present-vs-total over the last 8 weeks.</li>
          <li>The <b>Participation Points by Group</b> bar chart compares engagement across groups (penalties subtract).</li>
          <li>Use the <b>Overview</b> page for a quick snapshot and the <b>Leaderboard</b> to rank groups by points and mission completions.</li>
        </ul>
      </ClayCard>
    </div>
  );
}
