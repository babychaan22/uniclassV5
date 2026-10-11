import { cn } from "@/lib/utils";

const UI_ASSETS = Object.freeze({
  home: "home-3d-icon-png-download-3307683.png",
  classes: "open-book-3d-icon-png-download-3307676.png",
  students: "chatting-3d-icon-png-download-3307680.png",
  assessment: "calculator-3d-icon-png-download-3307646.png",
  attendance: "calendar-3d-icon-png-download-3307654.png",
  resources: "folder-3d-icon-png-download-3307660.png",
  ai: "desk-lamp-3d-icon-png-download-3307652.png",
  analytics: "telescope-3d-icon-png-download-3307649.png",
  settings: "setting-3d-icon-png-download-3307685.png",
  notifications: "notification-3d-icon-png-download-3307642.png",
  search: "binoculars-3d-icon-png-download-3307645.png",
  filter: "compass-3d-icon-png-download-3307659.png",
  profile: "camera-3d-icon-png-download-3307667.png",
  lock: "padlock-3d-icon-png-download-3307658.png",
  help: "like-3d-icon-png-download-3307679.png",
  upload: "upload-arrow-3d-icon-png-download-3307666.png",
  download: "download-3d-icon-png-download-3307653.png",
  edit: "click-3d-icon-png-download-3307664.png",
  delete: "trash-3d-icon-png-download-3307673.png",
  reward: "gift-box-3d-icon-png-download-3307684.png",
  badge: "certificate-3d-icon-png-download-3307644.png",
  view: "video-camera-3d-icon-png-download-3307640.png",
  menu: "play-3d-icon-png-download-3307677.png",
  missions: "rocket-3d-icon-png-download-3307661.png",
  qr: "magnifying-glass-3d-icon-png-download-3307638.png",
  scoreImport: "computer-3d-icon-png-download-3307655.png",
  activities: "writing-notes-3d-icon-png-download-3307639.png",
  history: "open-envelope-3d-icon-png-download-3307674.png",
  leaderboard: "trophy-3d-icon-png-download-3307665.png",
  archive: "empty-basket-3d-icon-png-download-3307643.png",
  points: "star-3d-icon-png-download-3307686.png",
  status: "bulb-3d-icon-png-download-3307681.png",
  streak: "rocket-3d-icon-png-download-3307661.png",
  streakFire: "fire-streak-3d.png",
  action: "dartboard-3d-icon-png-download-3307663.png",
  attention: "megaphone-3d-icon-png-download-3307651.png",
});

const SHARED_PROGRESS_ASSETS = new Set(["rocket-3d-icon-png-download-3307661.png"]);
const duplicateAssets = Object.values(UI_ASSETS).filter((file, index, files) => files.indexOf(file) !== index && !SHARED_PROGRESS_ASSETS.has(file));
if (duplicateAssets.length) {
  throw new Error("Each unrelated UniClass UI role must use a unique icon file.");
}

const UI_ASSET_TONES = {
  home: "sky", classes: "sky", students: "mint", assessment: "purple",
  attendance: "sky", resources: "purple", ai: "purple", analytics: "sky",
  settings: "purple", notifications: "pink", search: "sky", filter: "purple",
  profile: "mint", lock: "purple", help: "sky", upload: "sky", download: "purple",
  edit: "purple", delete: "coral", reward: "sun", badge: "sun", view: "sky", menu: "purple",
  missions: "teal", qr: "sky", scoreImport: "sky", activities: "mint", history: "teal", leaderboard: "sun", archive: "purple", points: "sun", status: "purple", streak: "teal", streakFire: "coral", action: "purple", attention: "pink",
};

// The pose set shares one silhouette, palette, and hand-painted finish so Nova
// feels native to the illustrated UniClass canvas in every context.
const NOVA_ROBOT = "/nova/nova-robot-v2.png";
const NOVA_TEACHER = "/nova/nova-robot-teacher.png";
const NOVA_CELEBRATE = "/nova/nova-robot-achievement-v2.png";
const NOVA_THINKING = "/nova/nova-robot-thinking-v2.png";
const NOVA_ASSESSMENT = "/nova/nova-robot-assessment-v2.png";
const NOVA_NOTIFICATION = "/nova/nova-robot-notification-v2.png";
const NOVA_ATTENDANCE = "/nova/nova-robot-attendance-v2.png";
const NOVA_EVIDENCE = "/nova/nova-robot-evidence-v2.png";
const NOVA_PROFILE = "/nova/nova-robot-profile-v2.png";
const NOVA_ASSETS = {
  welcome: NOVA_ROBOT,
  teacher: NOVA_TEACHER,
  celebrate: NOVA_CELEBRATE,
  assessment: NOVA_ASSESSMENT,
  achievement: NOVA_CELEBRATE,
  ai: NOVA_THINKING,
  success: NOVA_CELEBRATE,
  thinking: NOVA_THINKING,
  notification: NOVA_NOTIFICATION,
  attendance: NOVA_ATTENDANCE,
  evidence: NOVA_EVIDENCE,
  learning: NOVA_ROBOT,
  listening: NOVA_ROBOT,
  profile: NOVA_PROFILE,
};

const NOVA_ALIASES = { idea: "ai", tablet: "ai", quest: "assessment" };

export function UIAsset({ name, alt = "", className = "" }) {
  const file = UI_ASSETS[name];
  if (!file) return null;
  return <img src={`/brand/icons/${file}`} alt={alt} aria-hidden={alt ? undefined : true} loading="lazy" decoding="async" data-ui-tone={UI_ASSET_TONES[name] || "purple"} className={cn("uc-icon-3d select-none object-contain", className)} />;
}

export function NovaAsset({ pose = "welcome", alt = "", priority = false, className = "" }) {
  const src = NOVA_ASSETS[NOVA_ALIASES[pose] || pose] || NOVA_ASSETS.welcome;
  return <img src={src} alt={alt} aria-hidden={alt ? undefined : true} loading={priority ? "eager" : "lazy"} decoding="async" className={cn("uc-nova-asset object-contain", className)} />;
}

export const UI_ASSET_NAMES = Object.freeze(Object.keys(UI_ASSETS));
