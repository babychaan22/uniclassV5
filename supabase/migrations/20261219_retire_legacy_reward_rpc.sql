-- The request-id based reward overload belongs to the same retired points
-- balance implementation as the 20261218 routines. The active application
-- uses redeem_reward(uuid, uuid), which creates a reviewable group request.
-- This overload references the removed member_point_balances.id column.

drop function if exists public.redeem_reward(uuid, uuid, uuid, uuid, integer);
