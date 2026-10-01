// supabase/functions/send-push/index.ts
//
// Delivers queued notifications to each enrolled device using the standard Web
// Push encryption (RFC 8291/8292) with the app's VAPID keys. No third-party
// service is involved.
//
// Deploy:
//   supabase functions deploy send-push
//
// Required secrets (generate with `npx web-push generate-vapid-keys`):
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
//
// Triggered by a Supabase Database Webhook on INSERT into public.app_notifications,
// or called directly to retry a batch:
//   POST /functions/v1/send-push  { "notificationId": "<uuid>" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { webPushEncrypt } from 'https://deno.land/x/webpush@0.5.3/mod.ts';

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

// ── VAPID ────────────────────────────────────────────────────────────────
// The Authorization header must carry an ES256-signed JWT over
// "aud", "exp" and "sub". Signed here with WebCrypto rather than pulling in a
// dependency.

const base64url = (bytes: Uint8Array | ArrayBuffer): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function vapidAuthHeader(audience: string) {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: VAPID_SUBJECT,
      })
    )
  );

  const signingInput = new TextEncoder().encode(`${header}.${payload}`);

  // VAPID private keys are raw base64url scalars; the public key is the
  // uncompressed P-256 point 0x04 || X || Y.
  const publicKeyBytes = Uint8Array.from(
    atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')),
    (char) => char.charCodeAt(0)
  );
  const privateScalar = Uint8Array.from(
    atob(VAPID_PRIVATE_KEY.replace(/-/g, '+').replace(/_/g, '/')),
    (char) => char.charCodeAt(0)
  );

  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: base64url(publicKeyBytes.slice(1, 33)),
      y: base64url(publicKeyBytes.slice(33, 65)),
      d: base64url(privateScalar),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput)
  );

  // WebCrypto signs r||s; VAPID wants the raw 64-byte form, which is what this is.
  return `vapid t=${VAPID_PUBLIC_KEY}, s=${base64url(signature)}`;
}

async function sendToSubscription(
  subscription: { endpoint: string; p256dh: string; auth_key: string },
  payload: Record<string, unknown>,
) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { status: 0, gone: false, reason: 'vapid keys are not configured' };
  }

  const encrypted = await webPushEncrypt(
    JSON.stringify(payload),
    subscription.p256dh,
    subscription.auth_key,
    16,
  );

  const audience = new URL(subscription.endpoint).origin;

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(encrypted.byteLength),
      TTL: '86400',
      Urgency: 'normal',
      'Topic': 'uniclass-notifications',
      Authorization: await vapidAuthHeader(audience),
    },
    body: encrypted,
  });

  if (response.ok) return { status: response.status, gone: false, reason: '' };
  if (response.status === 404 || response.status === 410) {
    return { status: response.status, gone: true, reason: 'subscription expired' };
  }

  return {
    status: response.status,
    gone: false,
    reason: (await response.text()).slice(0, 200),
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  let notificationId: string | null = null;
  try {
    const body = await request.json();
    notificationId = body?.notificationId ?? null;
  } catch {
    // An empty body means "send everything unread".
  }

  // The table is app_notifications: an unrelated public.notifications table
  // already exists in this project and is not part of this feature.
  let query = db
    .from('app_notifications')
    .select('id, classroom_id, recipient_user_id, kind, title, body, link')
    .order('created_at', { ascending: false })
    .limit(50);

  if (notificationId) query = query.eq('id', notificationId);
  else query = query.eq('pushed_at', null);

  const { data: notifications, error } = await query;
  if (error) return json({ error: error.message }, 500);
  if (!notifications?.length) return json({ sent: 0, skipped: 0, note: 'nothing to send' });

  const notification = notifications[0];
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

  if (!subscriptions?.length) {
    await db.from('app_notifications').update({ pushed_at: new Date().toISOString() }).eq('id', notification.id);
    return json({ sent: 0, devices: 0, note: 'recipient has no registered device' });
  }

  let sent = 0;
  const dead: string[] = [];

  for (const subscription of subscriptions) {
    try {
      const result = await sendToSubscription(subscription, payload);
      if (result.status >= 200 && result.status < 300) sent += 1;
      if (result.gone) dead.push(subscription.endpoint);
    } catch (error) {
      console.error('push failed', subscription.endpoint, error);
    }
  }

  if (dead.length) await db.from('push_subscriptions').delete().in('endpoint', dead);
  await db.from('app_notifications').update({ pushed_at: new Date().toISOString() }).eq('id', notification.id);

  return json({ sent, devices: subscriptions.length, removed: dead.length });
});