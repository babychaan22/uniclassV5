-- Recipient corrections write two audit entries: a reversal and a credit.
-- Keep those entries valid without weakening the existing event-type guard.

alter table public.participation_logs
  drop constraint if exists participation_logs_event_type_check;

alter table public.participation_logs
  add constraint participation_logs_event_type_check check (
    event_type in (
      'scan',
      'gacha_win',
      'gacha_loss',
      'gacha_even',
      'behavior_penalty',
      'mission_redemption',
      'badge',
      'point_correction'
    )
  );
