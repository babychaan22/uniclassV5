-- Avatar choice and learner-wide visual themes replace the unused Nova
-- accessory catalog. Existing Nova claims are preserved in the ledger but no
-- longer appear or can be purchased.

update public.personal_reward_catalog
set is_active = false
where reward_type = 'nova_accessory';

insert into public.personal_reward_catalog(title, description, reward_type, asset_key, emoji, xp_cost, is_consumable)
select seed.title, seed.description, seed.reward_type, seed.asset_key, seed.emoji, seed.xp_cost, false
from (values
  ('Starry banner', 'A calm night-sky theme across your UniClass space.', 'banner_theme', 'starry-banner', '🌟', 40),
  ('Bright Spark', 'A title for learners who light up every lesson.', 'profile_sticker', 'bright-spark-title', '🌟', 20),
  ('Brave Explorer', 'A title for learners who try new challenges.', 'profile_sticker', 'brave-explorer-title', '🧭', 20),
  ('Kind Helper', 'A title for learners who make space for others.', 'profile_sticker', 'kind-helper-title', '💛', 20),
  ('Creative Thinker', 'A title for learners with imaginative ideas.', 'profile_sticker', 'creative-thinker-title', '🎨', 25),
  ('Problem Solver', 'A title for learners who keep working through a puzzle.', 'profile_sticker', 'problem-solver-title', '🧩', 25),
  ('Future Builder', 'A title for learners who turn ideas into action.', 'profile_sticker', 'future-builder-title', '🏗️', 25),
  ('Reading Rocket', 'A title for learners who launch into great books.', 'profile_sticker', 'reading-rocket-title', '🚀', 25),
  ('Math Magician', 'A title for learners who find patterns and strategies.', 'profile_sticker', 'math-magician-title', '🪄', 25),
  ('Science Scout', 'A title for learners who ask wonderful questions.', 'profile_sticker', 'science-scout-title', '🔬', 25),
  ('Team Champion', 'A title for learners who help their group shine.', 'profile_sticker', 'team-champion-title', '🏆', 30)
) as seed(title, description, reward_type, asset_key, emoji, xp_cost)
where not exists (select 1 from public.personal_reward_catalog c where c.asset_key = seed.asset_key);
