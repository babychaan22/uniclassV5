-- Group activities need one clear piece of proof, not one upload per learner.
-- A null group_member_id identifies a representative-uploaded group proof.

create or replace function public.record_activity_evidence(
  p_activity_id uuid,
  p_group_member_id uuid,
  p_storage_path text,
  p_original_name text,
  p_file_size integer,
  p_mime_type text default 'image/webp'
)
returns public.activity_evidence
language plpgsql security definer set search_path = public as $$
declare
  v_account public.group_accounts%rowtype;
  v_activity public.activities%rowtype;
  v_result public.activity_evidence%rowtype;
begin
  select * into v_activity from public.activities where id = p_activity_id;
  if not found then raise exception 'Activity not found'; end if;
  select * into v_account from public.group_accounts
    where user_id = auth.uid() and classroom_id = v_activity.classroom_id and is_approved = true
    order by created_date asc limit 1;
  if not found then raise exception 'Approved class membership required'; end if;

  if p_group_member_id is null then
    if not v_account.is_representative then
      raise exception 'Only the representative can upload proof for the whole group';
    end if;
  else
    if not exists (
      select 1 from public.group_members
      where id = p_group_member_id and group_id = v_account.group_id and classroom_id = v_account.classroom_id
    ) then raise exception 'Select a member from your group'; end if;
    if not v_account.is_representative and v_account.group_member_id <> p_group_member_id then
      raise exception 'Only the representative can upload proof for another member';
    end if;
  end if;

  if p_storage_path !~ ('^' || v_account.group_id::text || '/') then
    raise exception 'Evidence file must be stored in your group folder';
  end if;

  insert into public.activity_evidence(
    classroom_id, group_id, group_member_id, activity_id, uploaded_by,
    storage_path, original_name, file_size, mime_type
  ) values (
    v_account.classroom_id, v_account.group_id, p_group_member_id, p_activity_id, auth.uid(),
    p_storage_path, nullif(trim(p_original_name), ''), p_file_size, coalesce(nullif(trim(p_mime_type), ''), 'image/webp')
  ) returning * into v_result;
  return v_result;
end;
$$;

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
  select s.* into v_score from public.activity_scores s where s.id = p_activity_score_id for update;
  if not found then raise exception 'Saved activity score not found'; end if;
  select max_score into v_max from public.activities where id = v_score.activity_id;
  if auth_rep_group_id(v_score.classroom_id) is distinct from v_score.group_id then raise exception 'Only the approved representative may request a score edit'; end if;
  if p_proposed_score is null or p_proposed_score < 0 then raise exception 'The proposed score cannot be negative'; end if;
  if v_max is not null and p_proposed_score > v_max then raise exception 'The proposed score must be between 0 and %', v_max; end if;
  if p_proposed_score = v_score.score then raise exception 'The proposed score is already the saved score'; end if;
  if exists (select 1 from public.activity_score_edit_requests r where r.activity_score_id = p_activity_score_id and r.status = 'pending') then raise exception 'A score edit is already awaiting teacher approval'; end if;
  if p_evidence_id is null then raise exception 'Upload a new group proof before requesting a score edit'; end if;

  select e.* into v_evidence from public.activity_evidence e
  where e.id = p_evidence_id and e.activity_id = v_score.activity_id
    and (e.group_member_id = v_score.group_member_id or e.group_member_id is null)
    and e.classroom_id = v_score.classroom_id and e.group_id = v_score.group_id;
  if not found then raise exception 'The proof does not belong to this activity and group'; end if;
  if exists (
    select 1 from public.activity_evidence e2
    where e2.activity_id = v_score.activity_id and e2.group_id = v_score.group_id
      and (e2.group_member_id = v_score.group_member_id or e2.group_member_id is null)
      and e2.id <> p_evidence_id and e2.created_at >= v_evidence.created_at
  ) then raise exception 'Upload a fresh group proof before requesting a score edit'; end if;

  insert into public.activity_score_edit_requests(
    activity_score_id, activity_id, classroom_id, group_id, group_member_id,
    current_score, proposed_score, requested_by, evidence_id
  ) values (
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
  select * into v_result from public.activity_score_edit_requests where id = p_request_id for update;
  if not found then raise exception 'Score edit request not found'; end if;
  if not auth_is_teacher_of(v_result.classroom_id) then raise exception 'Only the classroom teacher may review a score edit'; end if;
  if v_result.status <> 'pending' then raise exception 'This score edit has already been reviewed'; end if;
  if p_approve then
    select e.* into v_evidence from public.activity_evidence e
    where e.id = v_result.evidence_id and e.activity_id = v_result.activity_id and e.group_id = v_result.group_id
      and (e.group_member_id = v_result.group_member_id or e.group_member_id is null);
    if not found then raise exception 'This request has no proof attached and cannot be approved'; end if;
    if exists (
      select 1 from public.activity_evidence e2
      where e2.activity_id = v_result.activity_id and e2.group_id = v_result.group_id
        and (e2.group_member_id = v_result.group_member_id or e2.group_member_id is null)
        and e2.id <> v_evidence.id and e2.created_at >= v_evidence.created_at
    ) then raise exception 'A newer group proof has already been uploaded. Ask the student to resend the request.'; end if;
    update public.activity_scores set score = v_result.proposed_score where id = v_result.activity_score_id;
  end if;
  update public.activity_score_edit_requests
  set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now()
  where id = v_result.id returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.record_activity_evidence(uuid, uuid, text, text, integer, text) from public;
revoke all on function public.request_activity_score_edit(uuid, numeric, uuid) from public;
revoke all on function public.review_activity_score_edit(uuid, boolean) from public;
grant execute on function public.record_activity_evidence(uuid, uuid, text, text, integer, text) to authenticated;
grant execute on function public.request_activity_score_edit(uuid, numeric, uuid) to authenticated;
grant execute on function public.review_activity_score_edit(uuid, boolean) to authenticated;
