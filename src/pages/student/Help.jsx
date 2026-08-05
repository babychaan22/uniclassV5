
import ClayCard from "@/components/ClayCard";
import { QrCode, Target, Award, HelpCircle } from "lucide-react";

export default function StudentHelp() {
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><HelpCircle className="w-6 h-6" /> Help Center</h1>
        <p className="text-ink/60 text-sm">Quick guides for using UniClass as a student.</p>
      </div>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-lg mb-2 flex items-center gap-2"><QrCode className="w-5 h-5" /> Scanning QR Codes</h2>
        <ol className="list-decimal list-inside space-y-1 text-sm text-ink/80">
          <li>Open the <b>Scan QR</b> page from the bottom nav.</li>
          <li>Point your camera at the QR code your teacher displays, or type the code manually.</li>
          <li>Standard codes add participation points instantly. Gacha codes let you spin for a multiplier — accept the risk for a chance at bonus points!</li>
          <li>Each code can only be used once, so scan quickly when your teacher posts one.</li>
        </ol>
      </ClayCard>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-lg mb-2 flex items-center gap-2"><Target className="w-5 h-5" /> Participating in Missions</h2>
        <ol className="list-decimal list-inside space-y-1 text-sm text-ink/80">
          <li>Check the <b>Missions</b> page for anything your teacher has posted as active.</li>
          <li>AI missions show true/false, multiple-choice, or drag-and-drop questions — answer them and tap <b>Submit for AI Grading</b>.</li>
          <li>Your score is graded automatically and converted into XP based on the mission's reward.</li>
          <li>Go to the XP wallet on the Missions page and redeem XP into participation points for your group.</li>
        </ol>
      </ClayCard>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-lg mb-2 flex items-center gap-2"><Award className="w-5 h-5" /> Redeeming Points &amp; Badges</h2>
        <ol className="list-decimal list-inside space-y-1 text-sm text-ink/80">
          <li>Earn participation points from QR scans, gacha wins, and mission XP redemptions.</li>
          <li>On weekends, open the <b>Badges</b> page to claim weekly achievement badges your group qualified for.</li>
          <li>Visit the <b>Rewards</b> page to spend points on items your teacher added to the shop.</li>
        </ol>
      </ClayCard>
    </div>
  );
}

