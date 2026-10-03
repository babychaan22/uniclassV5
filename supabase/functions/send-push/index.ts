// supabase/functions/send-push/index.ts
//
// Delivers queued notifications to each enrolled device using the standard Web
// Push encryption (RFC 8291/8292) with the app's VAPID keys. No third-party
// service is involved.
//
// Deploy:
//   supabase functions deploy send-push --no-verify-jwt
//
// Required secrets (generate with `npx web-push generate-vapid-keys`):
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
//
// Called by the database: an AFTER INSERT trigger on public.app_notifications
// posts { "notificationId": "<uuid>" } here. Calling it with an empty body
// retries everything not yet delivered.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// The previous implementation imported its crypto from deno.land/x/webpush,
// which has since been removed from that registry: the module 404s, so this
// function could not be bundled or deployed at all. web-push is the reference
// implementation of the same protocol and is what npx web-push generate-vapid-keys
// comes from, so the key format is identical.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ── Delivery ──────────────────────────────────────────────────────────────

type Outcome = { delivered: boolean; gone: boolean; reason: string };

async function sendToSubscription(
  subscription: { endpoint: string; p256dh: string; auth_key: string },
  payload: Record<string, unknown>,
): Promise<Outcome> {
  try {
    const result = await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
      },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: VAPID_SUBJECT,
          publicKey: VAPID_PUBLIC_KEY,
          privateKey: VAPID_PRIVATE_KEY,
        },
        TTL: 86400,
        urgency: 'normal',
      },
    );

    return { delivered: result.statusCode >= 200 && result.statusCode < 300, gone: false, reason: '' };
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 0;
    return {
      delivered: false,
      // 404 and 410 are the two a push service uses to say this subscription is
      // finished with and should be forgotten.
      gone: statusCode === 404 || statusCode === 410,
      reason: String((error as { message?: string }).message ?? error).slice(0, 200),
    };
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  let notificationId: string | null = null;
  try {
    const body = await request.json();
    notificationId = body?.notificationId ?? null;
  } catch {
    // An empty body means "send everything not yet delivered".
  }

  // If the VAPID keys are missing there is no way to deliver anything, so say so
  // loudly and leave every event undelivered. Marking them sent would drop them
  // on the floor permanently, and they would never be retried.
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json({
      sent: 0,
      devices: 0,
      error: 'vapid keys are not configured',
      note: 'notifications were left undelivered; set the secrets and run again to deliver them',
    }, 503);
  }

  // The table is app_notifications: an unrelated public.notifications table
  // already exists in this project and is not part of this feature.
  let query = db
    .from('app_notifications')
    .select('id, classroom_id, recipient_user_id, kind, title, body, link')
    .order('created_at', { ascending: false })
    .limit(50);

  if (notificationId) query = query.eq('id', notificationId);
  // is(), not eq(): eq with null asks PostgREST for the literal string "null"
  // and comes back as "invalid input syntax for type timestamp with time zone".
  else query = query.is('pushed_at', null);

  const { data: notifications, error } = await query;
  if (error) return json({ error: error.message }, 500);
  if (!notifications?.length) return json({ sent: 0, devices: 0, note: 'nothing to send' });

  const links: Record<string, string> = {
    announcement: '/student/dashboard',
    mission: '/student/missions',
    mission_status: '/student/missions',
    badge: '/student/badges',
    badge_award: '/student/badges',
    score_edit: '/student/scores',
    attendance: '/student/attendance',
    reward: '/student/rewards',
    points: '/student/history',
  };

  let sent = 0;
  let devices = 0;
  let withoutDevice = 0;
  let failed = 0;
  const dead: string[] = [];

  for (const notification of notifications) {
    const payload = {
      title: notification.title,
      body: notification.body,
      kind: notification.kind,
      tag: `uniclass-${notification.kind}`,
      url: notification.link || links[notification.kind] || '/student/dashboard',
    };

    const { data: subscriptions } = await db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .eq('user_id', notification.recipient_user_id);

    // Nobody is listening on a device. The event stays in the bell, which is
    // where the student reads it next time they open the app, and it is left
    // undelivered rather than being recorded as sent to a device that does not
    // exist.
    if (!subscriptions?.length) {
      withoutDevice += 1;
      continue;
    }

    let delivered = false;
    for (const subscription of subscriptions) {
      devices += 1;
      const result = await sendToSubscription(subscription, payload);

      if (result.delivered) {
        sent += 1;
        delivered = true;
      } else {
        failed += 1;
        if (result.reason) console.error('push failed', subscription.endpoint, result.reason);
      }
      if (result.gone) dead.push(subscription.endpoint);
    }

    // Only a device that actually accepted the payload counts as delivered, and
    // that verdict is per notification rather than for the whole batch.
    if (delivered) {
      await db.from('app_notifications')
        .update({ pushed_at: new Date().toISOString() })
        .eq('id', notification.id);
    }
  }

  if (dead.length) await db.from('push_subscriptions').delete().in('endpoint', dead);

  return json({ sent, devices, withoutDevice, failed, removed: dead.length });
});