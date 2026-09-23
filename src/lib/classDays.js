export const CLASS_DAY_OPTIONS = [
  { value: "1", label: "Mon", fullLabel: "Monday" },
  { value: "2", label: "Tue", fullLabel: "Tuesday" },
  { value: "3", label: "Wed", fullLabel: "Wednesday" },
  { value: "4", label: "Thu", fullLabel: "Thursday" },
  { value: "5", label: "Fri", fullLabel: "Friday" },
  { value: "6", label: "Sat", fullLabel: "Saturday" },
  { value: "7", label: "Sun", fullLabel: "Sunday" },
];

export function normalizeClassDays(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).filter((day) => CLASS_DAY_OPTIONS.some((option) => option.value === day)))]
    .sort()
    : [];
}

export function hasClassDays(classDays) {
  return normalizeClassDays(classDays).length > 0;
}

export function isScheduledClassDay(date, classDays) {
  const weekday = String(date.getUTCDay() || 7); // Monday = 1, Sunday = 7
  return normalizeClassDays(classDays).includes(weekday);
}

export function formatClassDays(classDays) {
  const selected = normalizeClassDays(classDays);
  return CLASS_DAY_OPTIONS.filter((option) => selected.includes(option.value)).map((option) => option.label).join(", ");
}
