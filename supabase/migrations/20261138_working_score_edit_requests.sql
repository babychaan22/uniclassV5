-- 20261138 — make the score-edit request actually work.
--
-- The request -> approve flow for activity scores has never run. The insert in
-- request_activity_score_edit() lists eight columns and omits current_score,
-- which activity_score_edit_requests declares NOT NULL with no default:
--
--   null value in column "current_score" of relation
--   "activity_score_edit_requests" violates not-null constraint
--
-- So every request died on the way in. No request row was ever created, the
-- teacher's review queue could never fill, approval was unreachable, and the
-- student saw the raw Postgres text in place of "Score edit request sent".
-- The teacher queue also renders `current_score`, so it showed "Group 1 ·  -> 8".
--
-- Two guarantees the requirement asks for were only enforced by the browser:
--
--   * "upload the image proof again, not just change the score" — the RPC
--     required proof, but treated "fresh" as "newer than the last *approved*
--     request". For the first edit of a score there is no baseline, so the
--     original submission's evidence row passed and a rep could reuse it by
--     calling the RPC directly.
--   * approval re-checked only that the evidence row existed, never that it
--     was still the newest proof.
--
-- Freshness is now a property of the evidence itself: the proof attached to a
-- request must be the most recent evidence for that activity and student. That
-- is true for the first edit and every edit after it, needs no baseline, and
-- cannot be satisfied by re-submitting an earlier photo.

create or replace function public.request_activity_score_edit(
  p_activity_score_id uuid,
  p_proposed_score numeric,
  p_evidence_id uuid default null
)
returns public.activity_score_edit_requests
language plpgsql security definer set search_path = public as $$
declare
  v_score public.activity_scores%rowtype;
  v_max numeric;
  v_evidence public.activity_evidence%rowtype;
  v_result public.activity_score_edit_requests%rowtype;
begin
  select s.* into v_score
  from public.activity_scores s
  where s.id = p_activity_score_id for update;
  if not found then raise exception 'Saved activity score not found'; end if;

  select max_score into v_max from public.activities where id = v_score.activity_id;

  if auth_rep_group_id(v_score.classroom_id) is distinct from v_score.group_id then
    raise exception 'Only the approved representative may request a score edit';
  end if;

  if p_proposed_score is null or p_proposed_score < 0 then
    raise exception 'The proposed score cannot be negative';
  end if;
  if v_max is not null and p_proposed_score > v_max then
    raise exception 'The proposed score must be between 0 and %', v_max;
  end if;

  if p_proposed_score = v_score.score then
    raise exception 'The proposed score is already the saved score';
  end if;

  if exists (
    select 1 from public.activity_score_edit_requests r
    where r.activity_score_id = p_activity_score_id and r.status = 'pending'
  ) then
    raise exception 'A score edit is already awaiting teacher approval';
  end if;

  -- Proof is mandatory, and it must be the newest proof for this activity and
  -- student. Anything older is a photo the teacher has already seen, so it
  -- cannot justify a changed score.
  if p_evidence_id is null then
    raise exception 'Upload a new photo of the work before requesting a score edit';
  end if;

  select e.* into v_evidence
  from public.activity_evidence e
  where e.id = p_evidence_id
    and e.activity_id = v_score.activity_id
    and e.group_member_id = v_score.group_member_id
    and e.classroom_id = v_score.classroom_id
    and e.group_id = v_score.group_id;

  if not found then
    raise exception 'The proof does not belong to this activity and student';
  end if;

  if exists (
    select 1 from public.activity_evidence e2
    where e2.activity_id = v_score.activity_id
      and e2.group_member_id = v_score.group_member_id
      and e2.id <> p_evidence_id
      and e2.created_at >= v_evidence.created_at
  ) then
    raise exception 'Upload a fresh photo of the work before requesting a score edit';
  end if;

  insert into public.activity_score_edit_requests(
    activity_score_id, activity_id, classroom_id, group_id, group_member_id,
    current_score, proposed_score, requested_by, evidence_id
  )
  values (
    v_score.id, v_score.activity_id, v_score.classroom_id, v_score.group_id, v_score.group_member_id,
    v_score.score, p_proposed_score, auth.uid(), p_evidence_id
  ) returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.review_activity_score_edit(p_request_id uuid, p_approve boolean)
returns public.activity_score_edit_requests
language plpgsql security definer set search_path = public as $$
declare
  v_result public.activity_score_edit_requests%rowtype;
  v_evidence public.activity_evidence%rowtype;
begin
  select * into v_result
  from public.activity_score_edit_requests
  where id = p_request_id for update;

  if not found then raise exception 'Score edit request not found'; end if;
  if not auth_is_teacher_of(v_result.classroom_id) then raise exception 'Only the classroom teacher may review a score edit'; end if;
  if v_result.status <> 'pending' then raise exception 'This score edit has already been reviewed'; end if;

  if p_approve then
    select e.* into v_evidence
    from public.activity_evidence e
    where e.id = v_result.evidence_id
      and e.group_member_id = v_result.group_member_id;

    if not found then
      raise exception 'This request has no proof attached and cannot be approved';
    end if;

    -- Re-check freshness: a newer photo means the student has already sent a
    -- better proof and this request is stale.
    if exists (
      select 1 from public.activity_evidence e2
      where e2.activity_id = v_result.activity_id
        and e2.group_member_id = v_result.group_member_id
        and e2.id <> v_evidence.id
        and e2.created_at >= v_evidence.created_at
    ) then
      raise exception 'A newer photo of this work has already been uploaded. Ask the student to resend the request.';
    end if;

    update public.activity_scores set score = v_result.proposed_score where id = v_result.activity_score_id;
  end if;

  update public.activity_score_edit_requests
  set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now()
  where id = v_result.id returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.request_activity_score_edit(uuid, numeric, uuid) from public;
revoke all on function public.review_activity_score_edit(uuid, boolean) from public;
grant execute on function public.request_activity_score_edit(uuid, numeric, uuid) to authenticated;
grant execute on function public.review_activity_score_edit(uuid, boolean) to authenticated;

-- The request cannot exist without its proof, so the column stops being
-- optional. Only enforceable while no legacy row lacks one.
do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans
  from public.activity_score_edit_requests
  where evidence_id is null;

  if v_orphans > 0 then
    raise notice 'leaving evidence_id nullable: % older request(s) have no proof attached', v_orphans;
  else
    alter table public.activity_score_edit_requests
      alter column evidence_id set not null;
  end if;
end;
$$;

-- ── Verification ─────────────────────────────────────────────────────────
-- The whole point: a representative with a freshly uploaded photo can request
-- an edit, the request records the score it is replacing, the teacher can
-- approve it, and the saved score changes. A request with no proof, or with a
-- proof older than one already on file, is refused.

do $$
declare
  v_case record;
  v_proposed numeric;
  v_score_before numeric;
  v_evidence public.activity_evidence%rowtype;
  v_request public.activity_score_edit_requests%rowtype;
  v_older uuid;
  v_approved public.activity_score_edit_requests%rowtype;
  v_after numeric;
  v_refused boolean;
  v_problems text[] := '{}';
begin
  -- A representative with a saved score and room to raise it.
  select ga.user_id, ga.classroom_id, ga.group_id, ga.group_member_id,
         s.id as score_id, s.group_member_id as scored_member, s.activity_id,
         s.score, a.max_score, c.teacher_id
    into v_case
  from public.group_accounts ga
  join public.group_members gm on gm.group_id = ga.group_id
  join public.activity_scores s on s.group_member_id = gm.id and s.classroom_id = ga.classroom_id
  join public.activities a on a.id = s.activity_id
  join public.classrooms c on c.id = ga.classroom_id
  where ga.is_approved
    and ga.is_representative
    and ga.group_member_id is not null
    and (a.max_score is null or a.max_score > s.score)
    and not exists (
      select 1 from public.activity_score_edit_requests r
      where r.activity_score_id = s.id and r.status = 'pending'
    )
  order by ga.created_date
  limit 1;

  if v_case.score_id is null then
    raise notice
      'skipped: no representative has a saved activity score with room to propose a higher one';
    return;
  end if;

  v_proposed := v_case.score + 1;
  v_score_before := v_case.score;

  -- Stand in for the student's upload. record_activity_evidence only checks
  -- that the path sits under the group folder, and the row is removed below.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.user_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.user_id::text, 'role', 'authenticated')::text);

  v_evidence := public.record_activity_evidence(
    v_case.activity_id, v_case.scored_member,
    v_case.group_id::text || '/verification-' || v_case.score_id::text || '.webp',
    'verification.webp', 1024, 'image/webp');

  -- 1. No proof at all is refused.
  v_refused := false;
  begin
    perform public.request_activity_score_edit(v_case.score_id, v_proposed, null);
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    v_problems := array_append(v_problems, 'a score edit was accepted with no proof attached');
  end if;

  -- 2. Proof older than one already on file is refused.
  select e.id into v_older
  from public.activity_evidence e
  where e.activity_id = v_case.activity_id
    and e.group_member_id = v_case.scored_member
    and e.id <> v_evidence.id
  order by e.created_at asc
  limit 1;

  if v_older is not null then
    v_refused := false;
    begin
      perform public.request_activity_score_edit(v_case.score_id, v_proposed, v_older);
    exception when others then
      v_refused := true;
    end;
    if not v_refused then
      v_problems := array_append(v_problems, 'a score edit was accepted using an older photo');
    end if;
  end if;

  -- 3. The fresh proof is accepted, and the request records what it replaces.
  v_request := public.request_activity_score_edit(v_case.score_id, v_proposed, v_evidence.id);

  if v_request.id is null then
    v_problems := array_append(v_problems, 'the request was not created');
  end if;
  if v_request.current_score is distinct from v_score_before then
    v_problems := array_append(v_problems,
      'the request recorded current_score ' || coalesce(v_request.current_score::text, 'null')
      || ' instead of ' || v_score_before);
  end if;
  if v_request.status <> 'pending' then
    v_problems := array_append(v_problems, 'a new request is not pending');
  end if;
  if v_request.evidence_id is distinct from v_evidence.id then
    v_problems := array_append(v_problems, 'the request did not keep the uploaded proof');
  end if;

  -- 4. The teacher approves and the saved score changes.
  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.teacher_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.teacher_id::text, 'role', 'authenticated')::text);

  v_approved := public.review_activity_score_edit(v_request.id, true);
  if v_approved.status <> 'approved' then
    v_problems := array_append(v_problems, 'approval did not record the decision');
  end if;

  select score into v_after from public.activity_scores where id = v_case.score_id;
  if v_after is distinct from v_proposed then
    v_problems := array_append(v_problems,
      'after approval the saved score is ' || coalesce(v_after::text, 'null') || ', expected ' || v_proposed);
  end if;

  -- Leave the classroom exactly as it was found.
  update public.activity_scores set score = v_score_before where id = v_case.score_id;
  delete from public.activity_score_edit_requests where id = v_request.id;
  delete from public.activity_evidence where id = v_evidence.id;

  if array_length(v_problems, 1) is not null then
    raise exception 'Score edit flow broken: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: a representative can request a score edit with freshly uploaded proof (recording % as the previous score), stale or missing proof is refused, and teacher approval replaces the saved score',
    v_score_before;
end;
$$;