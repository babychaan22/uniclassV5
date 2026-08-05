
const db = globalThis.__B44_DB__;

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import MascotWidget from "@/components/MascotWidget";
import { Hash, Users, Plus, X, ArrowRight, Star, ShieldCheck, Info } from "lucide-react";
import { ROUTES } from '@/lib/routes';

export default function StudentOnboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [joinCode, setJoinCode] = useState("");
  const [classroom, setClassroom] = useState(null);
  const [groups, setGroups] = useState([]);
  const [accounts, setAccounts] = useState([]); // all accounts in this classroom
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [wantsRep, setWantsRep] = useState(false);
  const [teammates, setTeammates] = useState([{ last_name: "", first_name: "" }]);
  const [email, setEmail] = useState(user?.email || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function check() {
      if (!user) return;
      const acc = await db.entities.GroupAccount.filter({ user_id: user.id });
      if (acc.length > 0) {
        navigate(acc[0].is_approved ? ROUTES.STUDENT.DASHBOARD : ROUTES.WAITING_APPROVAL, { replace: true });
      }
    }
    check();
  }, [user, navigate]);

  async function findClass(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const cr = await db.entities.Classroom.filter({ join_code: joinCode.toUpperCase().trim() });
      if (cr.length === 0) { setError("Invalid join code. Check with your teacher."); setLoading(false); return; }
      const c = cr[0];
      setClassroom(c);
      const [g, acc] = await Promise.all([
        db.entities.Group.filter({ classroom_id: c.id }),
        db.entities.GroupAccount.filter({ classroom_id: c.id }),
      ]);
      setGroups(g.sort((a, b) => a.group_number - b.group_number));
      setAccounts(acc);
      setStep(2);
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  function pickGroup(g) {
    setSelectedGroup(g);
    setWantsRep(false);
    setStep(3);
  }

  const repForGroup = (groupId) => accounts.find((a) => a.group_id === groupId && a.is_representative);
  const memberCountForGroup = (groupId) => accounts.filter((a) => a.group_id === groupId).length;

  function addTeammate() { setTeammates([...teammates, { last_name: "", first_name: "" }]); }
  function removeTeammate(i) { setTeammates(teammates.filter((_, idx) => idx !== i)); }
  function updateTeammate(i, field, val) {
    const next = [...teammates];
    next[i][field] = val.toUpperCase();
    setTeammates(next);
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!lastName || !firstName) { setError("Enter your last and first name."); return; }
    if (!email) { setError("Enter your email."); return; }
    setLoading(true);
    const norm = (s) => (s || "").toUpperCase().trim();

    try {
      // Re-fetch fresh data right before submitting to minimize race windows
      // (two students joining the same group at almost the same moment).
      const [classroomMembers, classroomAccounts] = await Promise.all([
        db.entities.GroupMember.filter({ classroom_id: classroom.id }),
        db.entities.GroupAccount.filter({ classroom_id: classroom.id }),
      ]);

      // A person (by name) can only enroll once across the whole classroom.
      const dupNameAcc = classroomAccounts.find(
        (a) => norm(a.last_name) === norm(lastName) && norm(a.first_name) === norm(firstName)
      );
      if (dupNameAcc) { setError("You may already be enrolled in this class."); setLoading(false); return; }

      const dupEmail = classroomAccounts.find((a) => a.email && norm(a.email) === norm(email));
      if (dupEmail) { setError("That email is already enrolled."); setLoading(false); return; }

      const groupMembers = classroomMembers.filter((m) => m.group_id === selectedGroup.id);
      const claimedMemberIds = new Set(classroomAccounts.filter((a) => a.group_member_id).map((a) => a.group_member_id));

      // Try to match an existing (unclaimed) roster entry with the same name
      // — e.g. the group's representative already listed this teammate.
      const existingMatch = groupMembers.find(
        (m) => norm(m.last_name) === norm(lastName) && norm(m.first_name) === norm(firstName)
      );
      if (existingMatch && claimedMemberIds.has(existingMatch.id)) {
        setError("Someone already enrolled under that name in this group.");
        setLoading(false);
        return;
      }

      let myMember = existingMatch;
      if (!myMember) {
        myMember = await db.entities.GroupMember.create({
          group_id: selectedGroup.id,
          classroom_id: classroom.id,
          last_name: norm(lastName),
          first_name: norm(firstName),
          is_account_holder: true,
        });
      } else if (!myMember.is_account_holder) {
        await db.entities.GroupMember.update(myMember.id, { is_account_holder: true });
      }

      // Representatives can optionally pre-list teammates who haven't
      // signed up yet, so attendance/scores can still be tracked for them.
      if (wantsRep) {
        for (const t of teammates) {
          if (!t.last_name || !t.first_name) continue;
          const dup = groupMembers.some(
            (m) => norm(m.last_name) === norm(t.last_name) && norm(m.first_name) === norm(t.first_name)
          ) || (norm(t.last_name) === norm(lastName) && norm(t.first_name) === norm(firstName));
          if (dup) continue;
          await db.entities.GroupMember.create({
            group_id: selectedGroup.id,
            classroom_id: classroom.id,
            last_name: norm(t.last_name),
            first_name: norm(t.first_name),
            is_account_holder: false,
          });
        }
      }

      try {
        await db.entities.GroupAccount.create({
          user_id: user.id,
          group_id: selectedGroup.id,
          classroom_id: classroom.id,
          group_member_id: myMember.id,
          last_name: norm(lastName),
          first_name: norm(firstName),
          email: email.trim(),
          is_approved: false,
          is_representative: wantsRep,
        });
      } catch (err) {
        // Postgres unique_violation — someone else claimed the
        // representative spot for this group a moment before us.
        if (err?.code === "23505" && wantsRep) {
          setError("Someone just claimed the representative role for this group. Joining you as a regular member instead — tap Join again.");
          setWantsRep(false);
          const acc = await db.entities.GroupAccount.filter({ classroom_id: classroom.id });
          setAccounts(acc);
          setLoading(false);
          return;
        }
        throw err;
      }

      navigate(ROUTES.WAITING_APPROVAL);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      const acc = await db.entities.GroupAccount.filter({ classroom_id: classroom.id });
      setAccounts(acc);
    }
    setLoading(false);
  }

  if (step === 1) {
    return (
      <div className="max-w-md mx-auto mt-6">
        <h1 className="text-2xl font-display font-extrabold mb-1">Join your class</h1>
        <p className="text-ink/60 mb-6">Enter the join code your teacher gave you.</p>
        <ClayCard className="p-6">
          <form onSubmit={findClass} className="space-y-4">
            <div>
              <label className="font-display font-bold text-sm mb-1 block flex items-center gap-2"><Hash className="w-4 h-4" /> Join Code</label>
              <input className="clay-input text-center text-2xl font-mono tracking-widest" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" required />
            </div>
            {error && <div className="flex items-center gap-2 rounded-xl border-2 border-ink bg-clay-sun/40 p-2"><MascotWidget state="error" size="sm" /><p className="text-clay-coral font-display font-bold text-sm">{error}</p></div>}
            <ClayButton type="submit" color="purple" size="lg" className="w-full" disabled={loading}>Find Class <ArrowRight className="w-5 h-5" /></ClayButton>
          </form>
        </ClayCard>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="max-w-lg mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-display font-extrabold mb-1">Pick your group</h1>
          <p className="text-ink/60">{classroom.grade_level} · {classroom.section}</p>
        </div>

        <ClayCard className="p-5">
          <p className="font-display font-bold mb-3 flex items-center gap-2"><Users className="w-5 h-5" /> Groups</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {groups.map((g) => {
              const rep = repForGroup(g.id);
              const count = memberCountForGroup(g.id);
              return (
                <button key={g.id} type="button" onClick={() => pickGroup(g)}
                  className="clay-btn flex flex-col items-start gap-1 px-3 py-3 bg-cream text-ink text-left">
                  <span className="text-lg font-display font-extrabold">Group {g.group_number}</span>
                  <div className="flex flex-wrap gap-1">
                    <ClayChip color="sky">{count} joined</ClayChip>
                    {rep ? (
                      <ClayChip color="purple">Rep: {rep.first_name}</ClayChip>
                    ) : (
                      <ClayChip color="sun">No rep yet</ClayChip>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </ClayCard>

        {error && <div className="flex items-center gap-2 rounded-xl border-2 border-ink bg-clay-sun/40 p-2"><MascotWidget state="error" size="sm" /><p className="text-clay-coral font-display font-bold text-sm">{error}</p></div>}
      </div>
    );
  }

  const existingRep = repForGroup(selectedGroup.id);

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <button type="button" className="text-sm text-ink/50 mb-2" onClick={() => setStep(2)}>&larr; Change group</button>
        <h1 className="text-2xl font-display font-extrabold mb-1">Join Group {selectedGroup.group_number}</h1>
        <p className="text-ink/60">{classroom.grade_level} · {classroom.section}</p>
      </div>

      <ClayCard className="p-5">
        <p className="font-display font-bold mb-3">Your name</p>
        <div className="flex gap-2">
          <input className="clay-input flex-1" placeholder="LAST NAME" value={lastName} onChange={(e) => setLastName(e.target.value.toUpperCase())} required />
          <input className="clay-input flex-1" placeholder="FIRST NAME" value={firstName} onChange={(e) => setFirstName(e.target.value.toUpperCase())} required />
        </div>
      </ClayCard>

      <ClayCard className="p-5">
        <p className="font-display font-bold mb-1">Your Email</p>
        <p className="text-xs text-ink/50 mb-2">Confirms your enrollment. You can only enroll once.</p>
        <input type="email" className="clay-input" placeholder="you@school.edu" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </ClayCard>

      <ClayCard className="p-5">
        <p className="font-display font-bold mb-1 flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Group Representative</p>
        {existingRep ? (
          <div className="flex items-start gap-2 text-sm text-ink/70 mt-1">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <p><strong>{existingRep.first_name} {existingRep.last_name}</strong> is already the representative for this group. You'll join as a regular member — you can still scan your own QR codes, but only the representative can submit attendance and activity scores.</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-ink/50 mb-3">Only one student per group can be the representative. The representative submits attendance and activity scores for the whole group. Everyone can still scan their own QR codes.</p>
            <button type="button" onClick={() => setWantsRep(!wantsRep)}
              className={`clay-btn w-full flex items-center justify-center gap-2 px-3 py-3 ${wantsRep ? "bg-clay-purple text-white" : "bg-cream text-ink"}`}>
              <Star className="w-4 h-4" /> {wantsRep ? "I'll be the Group Representative" : "Make me the Group Representative"}
            </button>
          </>
        )}
      </ClayCard>

      {wantsRep && !existingRep && (
        <ClayCard className="p-5">
          <p className="font-display font-bold mb-1">Add teammates (optional)</p>
          <p className="text-xs text-ink/50 mb-3">List groupmates who haven't signed up yet so you can track their attendance and scores too. They can claim their own account later using the same name.</p>
          <div className="space-y-2">
            {teammates.map((t, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input className="clay-input flex-1" placeholder="LAST NAME" value={t.last_name} onChange={(e) => updateTeammate(i, "last_name", e.target.value)} />
                <input className="clay-input flex-1" placeholder="FIRST NAME" value={t.first_name} onChange={(e) => updateTeammate(i, "first_name", e.target.value)} />
                <button type="button" onClick={() => removeTeammate(i)} className="clay-btn bg-clay-coral text-white px-2 py-2 shrink-0"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <ClayButton type="button" color="sky" size="sm" className="mt-3" onClick={addTeammate}><Plus className="w-4 h-4" /> Add Teammate</ClayButton>
        </ClayCard>
      )}

      {error && <div className="flex items-center gap-2 rounded-xl border-2 border-ink bg-clay-sun/40 p-2"><MascotWidget state="error" size="sm" /><p className="text-clay-coral font-display font-bold text-sm">{error}</p></div>}
      <ClayButton color="pink" size="lg" className="w-full" onClick={submit} disabled={loading}>{loading ? "Joining..." : "Join Class"}</ClayButton>
    </div>
  );
}
