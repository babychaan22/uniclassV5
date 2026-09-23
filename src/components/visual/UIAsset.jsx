import { cn } from "@/lib/utils";

const UI_ASSETS = {
  home: "/ui-kit/home.svg",
  classes: "/ui-kit/classroom.svg",
  students: "/ui-kit/students.svg",
  assessment: "/ui-kit/grade-sheet.svg",
  attendance: "/ui-kit/calendar-check.svg",
  resources: "/ui-kit/books.svg",
  ai: "/ui-kit/magic.svg",
  analytics: "/ui-kit/bar-chart.svg",
  settings: "/ui-kit/settings.svg",
  notifications: "/ui-kit/bell.svg",
  search: "/ui-kit/search.svg",
  filter: "/ui-kit/filter.svg",
  profile: "/ui-kit/profile.svg",
  help: "/ui-kit/help.svg",
  upload: "/ui-kit/upload.svg",
  download: "/ui-kit/download.svg",
  edit: "/ui-kit/pencil.svg",
  delete: "/ui-kit/trash.svg",
  reward: "/ui-kit/trophy.svg",
  badge: "/ui-kit/medal.svg",
  view: "/ui-kit/view.svg",
  menu: "/ui-kit/menu.svg",
};

const NOVA_ASSETS = {
  welcome: "/ui-kit/nova-welcome.svg",
  celebrate: "/ui-kit/nova-celebrate.svg",
  assessment: "/ui-kit/nova-assessment.svg",
  achievement: "/ui-kit/nova-achievement.svg",
  ai: "/ui-kit/nova-thinking.svg",
  success: "/ui-kit/nova-celebrate.svg",
  thinking: "/ui-kit/nova-thinking.svg",
  notification: "/ui-kit/nova-notification.svg",
  learning: "/ui-kit/nova-welcome.svg",
  listening: "/ui-kit/nova-listening.svg",
  profile: "/ui-kit/nova-profile.svg",
};

const NOVA_ALIASES = { teacher: "welcome", idea: "ai", tablet: "ai", quest: "assessment" };

export function UIAsset({ name, alt = "", className = "" }) {
  const src = UI_ASSETS[name];
  if (!src) return null;
  return <img src={src} alt={alt} aria-hidden={alt ? undefined : true} loading="lazy" decoding="async" className={cn("object-contain", className)} />;
}

export function NovaAsset({ pose = "welcome", alt = "", priority = false, className = "" }) {
  const src = NOVA_ASSETS[NOVA_ALIASES[pose] || pose] || NOVA_ASSETS.welcome;
  return <img src={src} alt={alt} aria-hidden={alt ? undefined : true} loading={priority ? "eager" : "lazy"} decoding="async" className={cn("object-contain", className)} />;
}

export const UI_ASSET_NAMES = Object.freeze(Object.keys(UI_ASSETS));
