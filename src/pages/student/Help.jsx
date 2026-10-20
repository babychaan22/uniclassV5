import ClayCard from "@/components/ClayCard";
import { UIAsset } from "@/components/visual/UIAsset";

const guides = [
  {
    icon: "home",
    title: "Start on your Dashboard",
    steps: [
      <>Use <b>Dashboard</b> to see your attendance, activity average, participation points, personal streak, and current status.</>,
      <>Open <b>Group Progress</b> to see how your group is building habits together.</>,
      <>Use the class switcher in the header before checking information for a different class.</>,
    ],
  },
  {
    icon: "attendance",
    title: "Record attendance and activity",
    steps: [
      <>Open <b>Attendance</b> when your teacher asks you to record your presence.</>,
      <>Open <b>Activity</b> to check posted work, your recorded scores, and any feedback.</>,
      <>Your streak grows through class-day participation, so keep attendance and activities up to date.</>,
    ],
  },
  {
    icon: "missions",
    title: "Complete missions and Daily Power-Ups",
    steps: [
      <>Check <b>Missions</b> for teacher or AI-made missions and the teacher-approved Daily Math Power-Up.</>,
      <>Answer every question, review your choices, then submit once for secure grading.</>,
      <>After submitting, open the answer review to see the method, work through the steps, and try a fresh practice version if one is available.</>,
    ],
  },
  {
    icon: "qr",
    title: "Earn participation points",
    steps: [
      <>Open <b>Scan</b> to scan a code your teacher displays or enter its code manually.</>,
      <>Points can come from scans, approved awards, mission XP conversions, and other class activities.</>,
      <>Each code is single-use. Gacha codes may offer a multiplier before points are awarded.</>,
    ],
  },
  {
    icon: "reward",
    title: "Use Rewards and personalize your profile",
    steps: [
      <>Your personal XP and your group participation points are separate.</>,
      <>You may redeem available XP into participation points. A fresh five-day streak of attendance, activity, or mission participation makes one avatar, theme, or name-style choice available—choosing a style does not deduct XP.</>,
      <>Group reward requests never spend your group’s points; your teacher approves eligible requests.</>,
    ],
  },
  {
    icon: "leaderboard",
    title: "Track progress and get support",
    steps: [
      <>Use <b>History</b> to review your past work and <b>Class Leaderboard</b> to view group or student standings.</>,
      <>Open <b>Badges</b> to see achievements your group can claim when eligible.</>,
      <>If something is missing, locked, or incorrect, take a screenshot and ask your teacher for help.</>,
    ],
  },
];

export default function StudentHelp() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="mb-1 flex items-center gap-2 text-2xl font-display font-extrabold"><UIAsset name="help" className="h-7 w-7" /> Help Center</h1>
        <p className="text-sm text-ink/60">A quick guide to the current UniClass student flow.</p>
      </div>

      <div className="space-y-3">
        {guides.map((guide) => (
          <ClayCard key={guide.title} className="p-4 sm:p-5">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-display font-bold"><UIAsset name={guide.icon} className="h-6 w-6" /> {guide.title}</h2>
            <ol className="list-decimal list-inside space-y-1 text-sm leading-relaxed text-ink/80">
              {guide.steps.map((step, index) => <li key={index}>{step}</li>)}
            </ol>
          </ClayCard>
        ))}
      </div>
    </div>
  );
}
