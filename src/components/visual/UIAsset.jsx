import { cn } from "@/lib/utils";
import NovaIcon from "@/components/visual/NovaIcon";

const UI_ASSETS = Object.freeze({
  home: "/ui-kit/free-icons/Building_perspective_matte_s.svg",
  classes: "/ui-kit/free-icons/Books_perspective_matte_s.svg",
  students: "/ui-kit/free-icons/User_perspective_matte_s.svg",
  assessment: "/ui-kit/free-icons/Clipboard_perspective_matte_s.svg",
  attendance: "/ui-kit/free-icons/Calendar_perspective_matte_s.svg",
  resources: "/ui-kit/free-icons/PDF_perspective_matte_s.svg",
  ai: "/ui-kit/free-icons/Light_bulb_perspective_matte_s.svg",
  analytics: "/ui-kit/free-icons/Chart_perspective_matte_s.svg",
  settings: "/ui-kit/free-icons/Tools_perspective_matte_s.svg",
  notifications: "/ui-kit/free-icons/Bell_perspective_matte_s.svg",
  search: "/ui-kit/free-icons/Magnifier_perspective_matte_s.svg",
  filter: "/ui-kit/free-icons/Diagram_perspective_matte_s.svg",
  profile: "/ui-kit/free-icons/Contact_perspective_matte_s.svg",
  help: "/ui-kit/free-icons/FAQ_perspective_matte_s.svg",
  upload: "/ui-kit/free-icons/Cloud_perspective_matte_s.svg",
  download: "/ui-kit/free-icons/Save_perspective_matte_s.svg",
  edit: "/ui-kit/free-icons/Pencil_perspective_matte_s.svg",
  delete: "/ui-kit/free-icons/Delete_perspective_matte_s.svg",
  reward: "/ui-kit/free-icons/Trophy_perspective_matte_s.svg",
  badge: "/ui-kit/free-icons/Crown_perspective_matte_s.svg",
  view: "/ui-kit/free-icons/Image_perspective_matte_s.svg",
  menu: "/ui-kit/free-icons/List_perspective_matte_s.svg",
  missions: "/ui-kit/free-icons/Target_perspective_matte_s.svg",
  qr: "/ui-kit/free-icons/QR%20code_perspective_matte_s.svg",
  scoreImport: "/ui-kit/free-icons/Exchange_perspective_matte_s.svg",
  activities: "/ui-kit/free-icons/Check_perspective_matte_s.svg",
  history: "/ui-kit/free-icons/Clock_perspective_matte_s.svg",
  leaderboard: "/ui-kit/free-icons/Star_perspective_matte_s.svg",
  archive: "/ui-kit/free-icons/Box_perspective_matte_s.svg",
});

if (new Set(Object.values(UI_ASSETS)).size !== Object.keys(UI_ASSETS).length) {
  throw new Error("Each UniClass UI asset must use a unique icon file.");
}

const UI_ASSET_TONES = {
  home: "sky", classes: "sky", students: "mint", assessment: "purple",
  attendance: "sky", resources: "purple", ai: "purple", analytics: "sky",
  settings: "purple", notifications: "pink", search: "sky", filter: "purple",
  profile: "mint", help: "sky", upload: "sky", download: "purple",
  edit: "purple", delete: "coral", reward: "sun", badge: "sun", view: "sky", menu: "purple",
  missions: "teal", qr: "sky", scoreImport: "sky", activities: "mint", history: "teal", leaderboard: "sun", archive: "purple",
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
  if (!UI_ASSETS[name]) return null;
  return <NovaIcon name={name} title={alt} data-ui-tone={UI_ASSET_TONES[name] || "purple"} className={cn("uc-icon-3d object-contain", className)} />;
}

export function NovaAsset({ pose = "welcome", alt = "", priority = false, className = "" }) {
  const src = NOVA_ASSETS[NOVA_ALIASES[pose] || pose] || NOVA_ASSETS.welcome;
  return <img src={src} alt={alt} aria-hidden={alt ? undefined : true} loading={priority ? "eager" : "lazy"} decoding="async" className={cn("object-contain", className)} />;
}

export const UI_ASSET_NAMES = Object.freeze(Object.keys(UI_ASSETS));
