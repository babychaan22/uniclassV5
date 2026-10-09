const QUOTES = [
  "A little progress today becomes a big win tomorrow.",
  "Curiosity is your superpower—keep asking great questions.",
  "You do not have to be perfect; you only have to keep going.",
  "Every practice round makes the next one easier.",
  "Your effort is building skills that last.",
  "Small, steady steps can take you somewhere amazing.",
  "Challenge is proof that your brain is growing.",
  "Show up, try again, and let your progress surprise you.",
];

export function getDailyMotivationQuote(seed = "learner", date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const value = [...`${seed}-${day}`].reduce((total, character) => total + character.charCodeAt(0), 0);
  return QUOTES[value % QUOTES.length];
}
