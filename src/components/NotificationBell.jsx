import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Bell, BellOff, Check } from "lucide-react";

const KINDS = {
  announcement: { color: "sky", label: "Announcement" },
  mission: { color: "purple", label: "Mission" },
  mission_status: { color: "purple", label: "Mission status" },
  badge: { color: "sun", label: "Badge" },
  badge_award: { color: "sun", label: "Badge earned" },
  score_edit: { color: "pink", label: "Score review" },
  attendance: { color: "sky", label: "Attendance" },
  reward: { color: "pink", label: "Reward" },
  points: { color: "lime", label: "Points" },
};

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export function notificationsEnabled() {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
    && process.env.VITE_VAPID_PUBLIC_KEY;
}

// Turns the browser subscription into a durable device row. Safe to call on
// every mount: it is an upsert on the push endpoint.
export async function syncPushSubscription() {
  if (!notificationsEnabled()) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.VITE_VAPID_PUBLIC_KEY),
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;

  await supabase.rpc("register_push_subscription", {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent,
  });

  return subscription;
}

export async function disablePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await supabase.rpc("unregister_push_subscription", { p_endpoint: subscription.endpoint });
  await subscription.unsubscribe().catch(() => {});
}

export default function NotificationBell({ teacher = false }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [listResult, countResult] = await Promise.all([
      supabase.rpc("list_notifications", { p_limit: 30 }),
      supabase.rpc("get_unread_notification_count"),
    ]);
    if (listResult.error) return;
    setItems(listResult.data || []);
    setUnread(Number(countResult.data || 0));
  }, []);

  useEffect(() => {
    setSupported(notificationsEnabled());
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    }
    load();

    // Refresh the badge the moment a notification lands, even if the tab was
    // backgrounded when it arrived.
    const channel = supabase
      .channel("uniclass-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "app_notifications" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function enable() {
    setBusy(true);
    setError("");
    try {
      const subscription = await syncPushSubscription();
      if (!subscription) {
        setPermission(typeof Notification !== "undefined" ? Notification.permission : "denied");
        setError("Your browser blocked notifications. Enable them for this site, then try again.");
        return;
      }
      setPermission("granted");
    } catch (err) {
      setError(err?.message || "Could not enable device notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError("");
    try {
      await disablePushNotifications();
      setPermission("default");
    } catch (err) {
      setError(err?.message || "Could not turn off device notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    await supabase.rpc("mark_notifications_read", { p_ids: null });
    load();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative rounded-xl p-2 text-[var(--uc-navy-800)] transition-colors hover:bg-clay-purple/10"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay-coral px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close notifications" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-ink/10 bg-white p-3 shadow-[var(--uc-shadow-lg)]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-display text-sm font-extrabold text-[var(--uc-navy-950)]">Notifications</p>
              {unread > 0 && (
                <button type="button" onClick={markAllRead} className="flex items-center gap-1 text-[10px] font-display font-bold text-clay-purple">
                  <Check className="h-3 w-3" /> Mark all read
                </button>
              )}
            </div>

            {supported && permission !== "granted" && (
              <div className="mb-2 rounded-xl border-2 border-clay-sky/40 bg-clay-sky/15 p-2.5">
                <p className="text-[11px] font-display font-bold text-ink/70">Get notified on this device when something changes.</p>
                <button
                  type="button"
                  onClick={enable}
                  disabled={busy}
                  className="clay-btn mt-1.5 w-full bg-clay-purple px-3 py-1.5 text-[11px] text-white disabled:opacity-60"
                >
                  {busy ? "Turning on…" : "Turn on device notifications"}
                </button>
              </div>
            )}

            {permission === "granted" && (
              <button type="button" onClick={disable} disabled={busy} className="mb-2 flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-[10px] font-display font-bold text-ink/50 hover:bg-cream disabled:opacity-60">
                <BellOff className="h-3 w-3" /> Turn off device notifications
              </button>
            )}

            {!supported && (
              <p className="mb-2 rounded-xl bg-cream px-2 py-1.5 text-[10px] text-ink/55">
                Device notifications are not available in this browser, but everything still appears here.
              </p>
            )}

            {error && <p className="mb-2 px-1 text-[10px] font-bold text-clay-coral">{error}</p>}

            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {items.length === 0 ? (
                <p className="py-6 text-center text-xs text-ink/50">Nothing new right now.</p>
              ) : (
                items.map((item) => {
                  const meta = KINDS[item.kind] || { color: "cream", label: item.kind };
                  const body = (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-display font-bold ${item.read_at ? "bg-cream text-ink/50" : "bg-clay-purple text-white"}`}>
                          {meta.label}
                        </span>
                        <span className="text-[9px] font-mono text-ink/40">
                          {new Date(item.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-display font-bold text-[var(--uc-navy-950)]">{item.title}</p>
                      <p className="text-[11px] leading-snug text-ink/60">{item.body}</p>
                    </>
                  );
                  return item.link ? (
                    <Link
                      key={item.id}
                      to={item.link}
                      onClick={() => {
                        supabase.rpc("mark_notifications_read", { p_ids: [item.id] });
                        setOpen(false);
                        load();
                      }}
                      className={`block rounded-xl border-2 border-ink/8 p-2.5 transition-colors hover:bg-cream ${item.read_at ? "opacity-70" : ""}`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div key={item.id} className={`rounded-xl border-2 border-ink/8 p-2.5 ${item.read_at ? "opacity-70" : ""}`}>{body}</div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}