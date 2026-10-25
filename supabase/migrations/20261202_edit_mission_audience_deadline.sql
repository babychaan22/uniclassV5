-- Update mission fields using their real database types, including JSON arrays
-- and booleans. Existing submissions and approval state are never rewritten.
create or replace function public.update_mission(p_mission_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_old public.missions%rowtype;
  v_new public.missions%rowtype;
  v_patch jsonb;
  v_allowed text[] := array['title','description','xp_reward','max_score','deadline','deadline_at',
    'image_url','formative_type','ai_content','answer_key','applies_to_all_classes','target_classroom_ids','target_statuses'];
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_old from public.missions where id = p_mission_id for update;
  if not found then raise exception 'Mission not found.'; end if;
  if not ((v_old.mission_source = 'daily_foundation' and v_old.classroom_id is null
    and exists (select 1 from public.classrooms c where c.teacher_id = v_user and public.foundation_class_serves_power_up(c.subject)))
    or public.auth_is_teacher_of(v_old.classroom_id)) then
    raise exception 'Only a teacher of this class can edit a mission.';
  end if;
  select jsonb_object_agg(e.key, e.value) into v_patch from jsonb_each(p_patch) e where e.key = any(v_allowed);
  if v_patch is null or v_patch = '{}'::jsonb then raise exception 'Nothing to update.'; end if;
  if v_old.mission_source = 'daily_foundation' and v_old.classroom_id is null
    and v_patch ?| array['deadline','deadline_at','applies_to_all_classes','target_classroom_ids'] then
    raise exception 'Shared Daily Power-Ups cannot be reassigned or rescheduled for one teacher.';
  end if;
  v_new := jsonb_populate_record(v_old, v_patch);
  if v_patch ? 'target_classroom_ids' or v_patch ? 'applies_to_all_classes' then
    if not coalesce(v_new.applies_to_all_classes, false) and cardinality(coalesce(v_new.target_classroom_ids, '{}'::uuid[])) = 0 then
      raise exception 'Select at least one class.';
    end if;
    if exists (select 1 from unnest(coalesce(v_new.target_classroom_ids, '{}'::uuid[])) wanted(id)
      where not exists (select 1 from public.classrooms c where c.id = wanted.id and c.teacher_id = v_old.created_by)) then
      raise exception 'A selected class does not belong to the mission teacher.';
    end if;
  end if;
  update public.missions set
    title = v_new.title, description = v_new.description, xp_reward = v_new.xp_reward,
    max_score = v_new.max_score, deadline = v_new.deadline, deadline_at = v_new.deadline_at,
    image_url = v_new.image_url, formative_type = v_new.formative_type, ai_content = v_new.ai_content,
    answer_key = v_new.answer_key, applies_to_all_classes = v_new.applies_to_all_classes,
    target_classroom_ids = v_new.target_classroom_ids, target_statuses = v_new.target_statuses
  where id = p_mission_id returning * into v_new;
  return jsonb_build_object('id', v_new.id, 'approval_status', v_new.approval_status, 'is_active', v_new.is_active);
end;
$$;
revoke all on function public.update_mission(uuid, jsonb) from public;
grant execute on function public.update_mission(uuid, jsonb) to authenticated;
