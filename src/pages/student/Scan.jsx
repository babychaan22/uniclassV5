
const db = globalThis.__B44_DB__;

import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import CapsulePop from "@/components/CapsulePop";
import Tambiolo from "@/components/Tambiolo";
import MascotWidget from "@/components/MascotWidget";
import Nova from "@/components/mascot/Nova";
import { peekQrCode, scanAndResolve } from "@/lib/scanService";
import { GACHA_OUTCOMES, MOOD_COLOR } from "@/lib/gacha";
import { getWeekStartManila } from "@/lib/week";
import { signedPoints } from "@/lib/stats";
import { QrCode as QrIcon, Camera, Keyboard, VolumeX, Volume2, Loader2, History, Star, Trophy } from "lucide-react";

export default function StudentScan() {
  const { user } = useAuth();
  const [account, setAccount] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberId, setMemberId] = useState(null);
  const [recipientType, setRecipientType] = useState("member");
  const [scanning, setScanning] = useState(false);
  const [manualHash, setManualHash] = useState("");
  const [phase, setPhase] = useState("idle");
  const [result, setResult] = useState(null);
  const [pendingHash, setPendingHash] = useState(null);
  const [pendingCode, setPendingCode] = useState(null);
  const [history, setHistory] = useState([]);
  const [soundOn, setSoundOn] = useState(false);
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  // FIX 6: post-scan summary banner
  const [summary, setSummary] = useState(null);
  const scannerRef = useRef(null);
  const html5Ref = useRef(null);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const a = await getActiveStudentAccount(user.id);
      if (!a) return;
      setAccount(a);
      const mem = await db.entities.GroupMember.filter({ group_id: a.group_id });
      setMembers(mem);
      const me = mem.find((m) => m.id === a.group_member_id) || mem.find((m) => m.is_account_holder) || mem[0];
      setMemberId(me?.id);
      const logs = await db.entities.ParticipationLog.filter({ group_id: a.group_id });
      setHistory(logs.sort((x, y) => (y.created_date || "").localeCompare(x.created_date || "")).slice(0, 15));
    }
    load();
  }, [user]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  async function stopCamera() {
    setScanning(false);
    if (html5Ref.current) {
      try { await html5Ref.current.stop(); await html5Ref.current.clear(); } catch (e) {}
      html5Ref.current = null;
    }
  }

  useEffect(() => () => { stopCamera(); }, []);

  // FIX 6: Calculate week total and rank after a successful scan
  const computeSummary = useCallback(async (pointsThisScan) => {
    if (!account) return;
    try {
      const classroomId = account.classroom_id;
      const weekStart = getWeekStartManila();
      const [allMembers, allLogs] = await Promise.all([
        db.entities.GroupMember.filter({ classroom_id: classroomId }),
        db.entities.ParticipationLog.filter({ classroom_id: classroomId }),
      ]);
      const weekEnd = new Date(weekStart + "T00:00:00");
      weekEnd.setDate(weekEnd.getDate() + 6);
      const weekEndStr = weekEnd.toISOString().slice(0, 10);
      const inWeek = (d) => {
        const day = (d || "").slice(0, 10);
        return day >= weekStart && day <= weekEndStr;
      };
      const totals = {};
      for (const m of allMembers) {
        totals[m.id] = allLogs
          .filter((l) => l.group_member_id === m.id && inWeek(l.created_date))
          .reduce((s, l) => s + signedPoints(l), 0);
      }
      if (recipientType === "group") {
        const groupTotal = allLogs.filter((log) => log.group_id === account.group_id && inWeek(log.created_date)).reduce((sum, log) => sum + signedPoints(log), 0);
        setSummary({ pointsThisScan, weekTotal: groupTotal, rank: "Group" });
      } else {
        const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
        const rank = sorted.findIndex(([id]) => id === memberId) + 1;
        setSummary({ pointsThisScan, weekTotal: totals[memberId] || 0, rank: rank || "—" });
      }
    } catch (e) { /* ignore */ }
  }, [account, memberId, recipientType]);

  async function handleScanTyped(hash) {
    if (resolving || phase !== "idle") return;
    if (!navigator.onLine) { setError('Reconnect before scanning. A code can only be awarded securely while online.'); return; }
    await stopCamera();
    setPendingHash(hash);
    setError("");
    setResolving(true);
    setSummary(null);
    const qr = await peekQrCode(hash);
    if (qr.error) {
      setError(qr.error);
      setResolving(false);
      setPendingHash(null);
      return;
    }
    setResolving(false);
    setPendingCode(qr);
    if (qr.qr_type === "gacha") {
      setPhase("risk");
    } else {
      setPhase("confirm");
    }
  }

  async function confirmScan() {
    if (!pendingHash) return;
    setResolving(true);
    const res = await scanAndResolve(pendingHash, recipientType === "member" ? memberId : null, false, recipientType);
    setResolving(false);
    if (res.error) { setError(res.error); setPhase("idle"); setPendingHash(null); setPendingCode(null); return; }
    setResult(res);
    setPhase("result");
    refreshHistory();
    computeSummary(res.points);
  }

  function refreshHistory() {
    async function load() {
      const logs = await db.entities.ParticipationLog.filter({ group_id: account.group_id });
      setHistory(logs.sort((x, y) => (y.created_date || "").localeCompare(x.created_date || "")).slice(0, 15));
    }
    if (account) load();
  }

  useEffect(() => { scannerRef.current = handleScanTyped; }, [memberId, recipientType, account, resolving, phase, computeSummary]);

  async function startCameraTyped() {
    setError("");
    if (!navigator.onLine) { setError('Reconnect before scanning. A code can only be awarded securely while online.'); return; }
    setScanning(true);
    setTimeout(async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        html5Ref.current = new Html5Qrcode("qr-reader");
        await html5Ref.current.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 200, height: 200 } },
          (decodedText) => scannerRef.current(decodedText)
        );
      } catch (err) {
        setError("Camera not available. Use manual entry below.");
        setScanning(false);
      }
    }, 100);
  }

  async function riskIt(choice) {
    if (!pendingHash) return;
    setResolving(true);
    const res = await scanAndResolve(pendingHash, recipientType === "member" ? memberId : null, choice === "risk", recipientType);
    setResolving(false);
    if (res.error) { setError(res.error); setPhase("idle"); setPendingHash(null); return; }
    if (choice === "safe" || res.gacha === null) {
      setResult(res);
      setPhase("result");
      refreshHistory();
      computeSummary(res.points);
    } else {
      setResult(res);
      setPhase("spinning");
      refreshHistory();
      computeSummary(res.points);
    }
  }

  function reset() {
    setPhase("idle");
    setResult(null);
    setPendingHash(null);
    setPendingCode(null);
    setError("");
    setSummary(null);
  }

  if (!account) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-extrabold flex items-center gap-2"><QrIcon className="w-6 h-6" /> Scan QR</h1>
          <p className="text-ink/60 text-sm">Earn participation points</p>
        </div>
        <button onClick={() => setSoundOn(!soundOn)} className={`clay-btn px-3 py-2 ${soundOn ? "bg-clay-lime text-ink" : "bg-cream text-ink/60"}`}>
          {soundOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
      </div>

      {!online && <ClayCard color="sun" className="p-3 text-sm"><p className="font-display font-bold">Offline learning mode</p><p className="text-ink/70 mt-1">Previously opened pages remain available, but scans, uploads, and point changes are paused. Reconnect to make sure your points are saved.</p></ClayCard>}

      {/* FIX 6: Post-scan summary banner */}
      {summary && (
        <div className="sticky top-20 z-30 clay-tile bg-clay-sun p-3 flex items-center justify-around gap-2 text-sm">
          <div className="flex items-center gap-1.5">
            <Star className="w-5 h-5 text-clay-coral" />
            <span className="font-display font-bold">+{summary.pointsThisScan} pts</span>
          </div>
          <div className="h-8 w-0.5 bg-ink/20" />
          <div className="flex items-center gap-1.5">
            <Trophy className="w-5 h-5 text-clay-purple" />
            <span className="font-display font-bold">Week: {Math.round(summary.weekTotal)} pts</span>
          </div>
          <div className="h-8 w-0.5 bg-ink/20" />
          <div className="flex items-center gap-1.5">
            <span className="text-lg">🏅</span>
            <span className="font-display font-bold">Rank #{summary.rank}</span>
          </div>
        </div>
      )}

      <ClayCard className="p-4">
        <label className="font-display font-bold text-sm mb-1 block">Who earns these points?</label>
        <select className="clay-input" value={recipientType === "group" ? "group" : memberId || ""} onChange={(e) => {
          if (e.target.value === "group") setRecipientType("group");
          else { setRecipientType("member"); setMemberId(e.target.value); }
        }}>
          <option value="group">Whole group</option>
          {members.map((m) => (<option key={m.id} value={m.id}>{m.last_name}, {m.first_name}</option>))}
        </select>
        <p className="text-xs text-ink/50 mt-1">Choose a member for personal points, or the whole group for shared points.</p>
      </ClayCard>

      {phase === "idle" && (
        <>
          <ClayCard className="p-4">
            {scanning ? (
              <div>
                <div id="qr-reader" className="w-full rounded-xl overflow-hidden border-2 border-ink" />
                <ClayButton color="coral" className="w-full mt-3" onClick={stopCamera}>Stop Camera</ClayButton>
              </div>
            ) : (
              <div className="text-center py-6">
                <Camera className="w-12 h-12 mx-auto text-clay-purple mb-3" />
                <ClayButton color="purple" size="lg" onClick={startCameraTyped} className="w-full" disabled={!online}>Start Camera Scan</ClayButton>
              </div>
            )}
          </ClayCard>

          <ClayCard className="p-4">
            <p className="font-display font-bold text-sm mb-2 flex items-center gap-2"><Keyboard className="w-4 h-4" /> Manual Entry</p>
            <p className="text-xs text-ink/50 mb-2">No camera? Type the QR code hash here.</p>
            <div className="flex gap-2">
              <input className="clay-input font-mono" placeholder="ENTER HASH" value={manualHash} onChange={(e) => setManualHash(e.target.value.toUpperCase())} />
              <ClayButton color="sky" onClick={() => { setManualHash(""); handleScanTyped(manualHash); }} disabled={!manualHash || resolving}>
                {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Go"}
              </ClayButton>
            </div>
          </ClayCard>
          {error && <div className="flex items-center justify-center gap-3 rounded-xl border-2 border-ink bg-clay-sun/40 p-3 text-center"><MascotWidget state="error" size="sm" /><p className="text-clay-coral font-display font-bold text-sm">{error}</p></div>}
        </>
      )}

      {phase === "risk" && (
        <ClayCard color="purple" className="p-6 text-center">
          <p className="font-display font-bold text-lg text-white mb-2">Gacha Code Detected!</p>
          <p className="text-white/80 mb-4">Try your luck for a points multiplier?</p>
          <div className="flex flex-col gap-3">
            <ClayButton color="lime" size="lg" onClick={() => riskIt("safe")} disabled={resolving}>Keep it Safe</ClayButton>
            <ClayButton color="pink" size="lg" onClick={() => riskIt("risk")} disabled={resolving}>
              {resolving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Risk It! 🔥"}
            </ClayButton>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-left text-[11px] text-white/80">
            <span>0.5× · Try again next time!</span><span>1.0× · Your points are safe!</span>
            <span>1.5× · You lucky duck!</span><span>2.0× · Jackpot! Wohoo!</span>
          </div>
        </ClayCard>
      )}

      {phase === "confirm" && pendingCode && (
        <ClayCard color="sky" className="p-5 text-center">
          <p className="font-display font-extrabold text-lg mb-1">Confirm this code</p>
          <p className="text-sm text-ink/65 mb-4">Check the code and recipient before points are awarded. Each code can be used once.</p>
          <div className="rounded-xl border-2 border-ink bg-cream p-3 text-left text-sm space-y-1 mb-4">
            <p><span className="font-display font-bold">Code:</span> {String(pendingHash || '').slice(0, 18)}</p>
            <p><span className="font-display font-bold">Points:</span> {pendingCode.base_points || 0} pts</p>
            <p><span className="font-display font-bold">Recipient:</span> {recipientType === 'group' ? 'Whole Group' : (() => { const member = members.find((item) => item.id === memberId); return member ? `${member.last_name}, ${member.first_name}` : 'Student'; })()}</p>
          </div>
          <div className="flex gap-2"><ClayButton color="white" className="flex-1" onClick={reset}>Cancel</ClayButton><ClayButton color="lime" className="flex-1" onClick={confirmScan} disabled={resolving}>{resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm & award'}</ClayButton></div>
        </ClayCard>
      )}

      {phase === "spinning" && result?.gacha && (
        <ClayCard className="p-6">
          <p className="text-center font-display font-bold text-lg mb-2">Tambiolo Draw!</p>
          <Tambiolo targetIndex={result.gacha.index ?? 3} soundOn={soundOn} onDone={() => setPhase("result")} />
        </ClayCard>
      )}

      {phase === "result" && result && (
        <div className="text-center">
          <CapsulePop trigger={Date.now()} className="flex flex-col items-center">
            <div className="relative mb-3">
              <MascotWidget state="excited" size="md" />
              <Nova variant="celebrate" size="sm" className="absolute -bottom-1 -right-2 h-8 w-8 opacity-90" />
            </div>
            <ClayCard color={result.gacha ? MOOD_COLOR[result.gacha.mood] : "lime"} className="p-8 text-center max-w-xs mx-auto">
              <div className="text-5xl mb-2">
                {result.gacha ? GACHA_OUTCOMES.find((o) => o.mult === result.gacha.multiplier)?.emoji : "🎉"}
              </div>
              {result.gacha && (
                <>
                  <p className="font-display font-extrabold text-2xl mb-1">{GACHA_OUTCOMES.find((o) => o.mult === result.gacha.multiplier)?.label}</p>
                  <p className="font-mono text-lg mb-2">{result.gacha.multiplier}× multiplier</p>
                </>
              )}
              <p className="font-display font-extrabold text-4xl text-ink mt-2">+{result.points}</p>
              <p className="font-display font-bold text-sm opacity-80">POINTS</p>
            </ClayCard>
          </CapsulePop>
          <ClayButton color="purple" size="lg" className="mt-5" onClick={reset}>Scan Another</ClayButton>
        </div>
      )}

      <ClayCard className="p-4">
        <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2"><History className="w-4 h-4" /> Recent Scans</h2>
        {history.length === 0 ? (
          <p className="text-ink/50 text-sm">No scans yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {history.map((log) => {
              const m = members.find((x) => x.id === log.group_member_id);
              const color = log.event_type === "gacha_win" ? "lime" : log.event_type === "gacha_loss" ? "coral" : log.event_type === "gacha_even" ? "sun" : "sky";
              const points = `+${log.points_awarded}${log.multiplier && log.multiplier !== 1 ? ` (${log.multiplier}×)` : ""} pts`;
              const recipient = log.recipient_type === "group" || !log.group_member_id
                ? "Whole Group"
                : m ? `${m.last_name}, ${m.first_name[0]}.` : "Student";
              return (
                <div key={log.id} className="flex items-center justify-between text-sm border-b border-ink/10 pb-1.5">
                  <span className="font-body truncate">{recipient}</span>
                  <ClayChip color={color}>{points}</ClayChip>
                </div>
              );
            })}
          </div>
        )}
      </ClayCard>
    </div>
  );
}
