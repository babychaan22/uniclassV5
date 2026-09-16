
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import MascotWidget from "@/components/MascotWidget";
import { Hash, Users, Plus, X, ArrowRight, Star, ShieldCheck, Info } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import { joinClassroom, lookupClassroomByJoinCode } from '@/lib/secureActions';

export default function StudentOnboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const addingClass = searchParams.get("add") === "1";
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
  const [existingAccounts, setExistingAccounts] = useState([]);

  useEffect(() => {
    async function check() {
      if (!user) return;
      const acc = await db.entities.GroupAccount.filter({ user_id: user.id });
      setExistingAccounts(acc);
      if (acc.length > 0 && !addingClass) {
        navigate(acc[0].is_approved ? ROUTES.STUDENT.DASHBOARD : ROUTES.WAITING_APPROVAL, { replace: true });
      }
    }
    check();
  }, [user, navigate, addingClass]);

  async function findClass(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await lookupClassroomByJoinCode(joinCode.toUpperCase().trim());
      setClassroom(result.classroom);
      setGroups((result.groups || []).sort((a, b) => a.group_number - b.group_number));
      setAccounts(result.accounts || []);
      if (result.classroom.uses_groups === false) {
        setSelectedGroup({ id: null, group_number: null });
        setWantsRep(true);
        setStep(3);
      } else setStep(2);
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
      await joinClassroom({
        p_join_code: joinCode.toUpperCase().trim(),
        p_group_id: selectedGroup?.id || null,
        p_last_name: norm(lastName),
        p_first_name: norm(firstName),
        p_email: email.trim(),
        p_wants_representative: wantsRep || classroom.uses_groups === false,
        p_teammates: teammates.filter((t) => t.last_name && t.first_name),
      });

      navigate(ROUTES.WAITING_APPROVAL);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      // The join operation is transactional; a retry starts from a clean state.
    }
    setLoading(false);
  }

  if (step === 1) {
    return (
      <div className="max-w-md mx-auto mt-6">
        <h1 className="text-2xl font-display font-extrabold mb-1">{addingClass ? "Join another class" : "Join your class"}</h1>
        <p className="text-ink/60 mb-6">Enter the join code your teacher gave you.</p>
        {addingClass && existingAccounts.length > 0 && <ClayCard className="p-4 mb-4"><p className="font-display font-bold text-sm mb-2">Your current class memberships</p><div className="space-y-1 text-xs text-ink/60">{existingAccounts.map((a) => <p key={a.id}>{a.is_approved ? "Approved" : "Waiting for approval"} · {a.is_representative ? "Representative" : "Member"}</p>)}</div><Link className="text-xs text-clay-purple underline mt-2 inline-block" to={ROUTES.STUDENT.DASHBOARD}>Return to dashboard</Link></ClayCard>}
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
        {classroom.uses_groups !== false && <button type="button" className="text-sm text-ink/50 mb-2" onClick={() => setStep(2)}>&larr; Change group</button>}
        <h1 className="text-2xl font-display font-extrabold mb-1">{classroom.uses_groups === false ? "Join as an individual student" : `Join Group ${selectedGroup.group_number}`}</h1>
        <p className="text-ink/60">{classroom.grade_level} · {classroom.section}</p>
      </div>

      <ClayCard className="p-5">
        <p className="font-display font-bold mb-3">Your name</p>
        <div className="flex gap-2">
          <div className="flex-1"><label className="font-display font-bold text-xs mb-1 block">Last name</label><input className="clay-input w-full" placeholder="e.g. Santos" value={lastName} onChange={(e) => setLastName(e.target.value.toUpperCase())} required /></div>
          <div className="flex-1"><label className="font-display font-bold text-xs mb-1 block">First name</label><input className="clay-input w-full" placeholder="e.g. Ana" value={firstName} onChange={(e) => setFirstName(e.target.value.toUpperCase())} required /></div>
        </div>
      </ClayCard>

      {classroom.uses_groups === false && <ClayCard className="p-5"><p className="font-display font-bold mb-1">Individual class access</p><p className="text-sm text-ink/60">This class does not use groups. You will manage your own attendance, activity scores, and evidence.</p></ClayCard>}

      <ClayCard className="p-5">
        <p className="font-display font-bold mb-1">Your Email</p>
        <p className="text-xs text-ink/50 mb-2">Confirms your enrollment. You can only enroll once.</p>
        <input type="email" className="clay-input" placeholder="you@school.edu" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </ClayCard>

      {classroom.uses_groups !== false && <ClayCard className="p-5">
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
      </ClayCard>}

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
