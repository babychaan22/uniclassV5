
// All "this week" computations pinned to Asia/Manila timezone.

export function getWeekStartManila(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(date).split("-").map(Number);
  const manilaDate = new Date(Date.UTC(y, m - 1, d));
  const day = manilaDate.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  manilaDate.setUTCDate(manilaDate.getUTCDate() + diff);
  return manilaDate.toISOString().slice(0, 10);
}

export function getBadgeDisplayWeekStartManila(date = new Date()) {
  const weekStart = getWeekStartManila(date);
  if (!isEndOfWeekManila(date)) return weekStart;
  const nextMonday = new Date(`${weekStart}T00:00:00Z`);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  return nextMonday.toISOString().slice(0, 10);
}

export function getTodayManila() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export function toManilaDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function isDateInRange(dateStr, startDate, endDate) {
  if (!startDate || !endDate) return true;
  return dateStr >= startDate && dateStr <= endDate;
}

export function getManilaDayOfWeek(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short" }).format(date);
}

export function isEndOfWeekManila(date = new Date()) {
  const d = getManilaDayOfWeek(date);
  return d === "Sat" || d === "Sun";
}

export function isWeekdayManila(date = new Date()) {
  const d = getManilaDayOfWeek(date);
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(d);
}

