// supabase/functions/openrouter-proxy/index.ts
//
// Proxies OpenRouter calls so the API key never reaches the browser.
//
// Deploy:
//   supabase functions deploy openrouter-proxy
//
// Set the secret once (keep out of .env files / source control):
//   supabase secrets set OPENROUTER_API_KEY=sk-or-...
//
// Optional: override the router with a specific current free model:
//   supabase secrets set OPENROUTER_MODEL=openrouter/free

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'https://uniclass.app';

const CONFIGURED_MODEL = Deno.env.get('OPENROUTER_MODEL') ?? '';
const IMAGE_MODEL = Deno.env.get('OPENROUTER_IMAGE_MODEL') ?? 'google/gemini-3.1-flash-image-preview';

async function getFreeModelChain(apiKey: string): Promise<string[]> {
  const chain = CONFIGURED_MODEL && CONFIGURED_MODEL !== 'openrouter/free'
    ? [CONFIGURED_MODEL]
    : [];
  let catalogError = '';
  // Prefer the user-filtered catalog. It reflects provider preferences and
  // guardrails, unlike the public catalog which can contain stale entries.
  for (const catalogUrl of [
    'https://openrouter.ai/api/v1/models/user',
    'https://openrouter.ai/api/v1/models',
  ]) {
    try {
      const response = await fetch(catalogUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        catalogError = `OpenRouter model catalog returned HTTP ${response.status}.`;
        continue;
      }
      const data = await response.json();
      const freeModels = (data?.data ?? [])
        .filter((model: { id?: string; pricing?: { prompt?: string; completion?: string } }) =>
          model.id && model.id.endsWith(':free') &&
          Number(model.pricing?.prompt) === 0 && Number(model.pricing?.completion) === 0)
        .map((model: { id: string }) => model.id)
        // Prefer text-capable flash/small models for short JSON generation.
        .sort((a: string, b: string) => {
          const score = (id: string) => (/(flash|small|mini|lite)/i.test(id) ? 0 : 1);
          return score(a) - score(b);
        })
        .slice(0, 12);
      chain.push(...freeModels);
      if (freeModels.length > 0) break;
    } catch (error) {
      catalogError = `Network error reading OpenRouter model catalog: ${(error as Error).message}`;
    }
  }
  return [...new Set(chain)].filter(Boolean).concat(catalogError ? [`__catalog_error__:${catalogError}`] : []);
}

async function generateImage(apiKey: string, prompt: string, draftKey: string, userId: string, supabaseClient: ReturnType<typeof createClient>): Promise<Response> {
  const { error: quotaError } = await supabaseClient.rpc('consume_ai_image_quota', { p_draft_key: draftKey });
  if (quotaError) return json({ error: quotaError.message }, 429);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': APP_ORIGIN,
        'X-Title': 'UniClass',
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['text', 'image'],
        image_config: { aspect_ratio: '16:9', image_size: '1K' },
      }),
    });
  } catch (error) {
    return json({ error: `Network error reaching OpenRouter image generation: ${(error as Error).message}` }, 502);
  }
  if (!response.ok) return json({ error: `OpenRouter image model "${IMAGE_MODEL}" returned HTTP ${response.status}: ${await response.text()}` }, 502);

  const data = await response.json();
  const imageUrl = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? '';
  if (!imageUrl) return json({ error: `Image model "${IMAGE_MODEL}" returned no image.` }, 502);

  if (!imageUrl.startsWith('data:image/')) return json({ imageUrl });
  const match = imageUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
  if (!match) return json({ error: 'Image provider returned an unsupported image format.' }, 502);
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const path = `${userId}/${crypto.randomUUID()}.${match[1].split('/')[1] === 'jpeg' ? 'jpg' : 'png'}`;
  const { error: uploadError } = await admin.storage.from('mission-images').upload(path, bytes, { contentType: match[1], upsert: false });
  if (uploadError) return json({ error: `Generated image could not be stored: ${uploadError.message}` }, 502);
  const { data: publicData } = admin.storage.from('mission-images').getPublicUrl(path);
  return json({ imageUrl: publicData.publicUrl });
}

const CORS_HEADERS = {
  // The function still requires a valid Supabase user token, so allowing the
  // browser origin here does not make the AI endpoint public.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // ── Auth check ──────────────────────────────────────────────────────────────
  // Verify the caller is an authenticated Supabase user. This blocks anyone
  // who tries to hit the function directly without a valid session token.
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // ── Key check ───────────────────────────────────────────────────────────────
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) {
    return json(
      { error: 'OpenRouter API key not configured on the server. Run: supabase secrets set OPENROUTER_API_KEY=sk-or-...' },
      500,
    );
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let prompt: string;
  let kind = 'text';
  let draftKey = '';
  try {
    ({ prompt, kind = 'text', draftKey = '' } = await req.json());
  } catch {
    return json({ error: 'Request body must be JSON with a "prompt" field.' }, 400);
  }
  if (!prompt) {
    return json({ error: '"prompt" is required.' }, 400);
  }
  if (typeof prompt !== 'string' || prompt.length > 12000) {
    return json({ error: 'Prompt is too long.' }, 413);
  }

  if (kind === 'image') {
    if (!draftKey) return json({ error: 'draftKey is required for image generation.' }, 400);
    return generateImage(apiKey, prompt, draftKey, user.id, supabaseClient);
  }

  // ── Model fallback chain ────────────────────────────────────────────────────
  let lastError = 'No currently available free OpenRouter model was found. Try again shortly.';
  const failedModels: string[] = [];

  const modelChain = await getFreeModelChain(apiKey);
  for (const model of modelChain) {
    if (model.startsWith('__catalog_error__:')) {
      lastError = model.slice('__catalog_error__:'.length);
      continue;
    }
    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': APP_ORIGIN,
          'X-Title': 'UniClass',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are a precise assistant that replies with ONLY valid JSON. ' +
                'No markdown code fences, no prose before or after the JSON object.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
        }),
      });
    } catch (networkErr) {
      lastError = `Network error reaching OpenRouter: ${(networkErr as Error).message}`;
      continue;
    }

    // Retriable statuses → try the next model
    if ([400, 404, 429, 502, 503].includes(response.status)) {
      lastError = `Model "${model}" unavailable (HTTP ${response.status}).`;
      failedModels.push(`${model}=${response.status}`);
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      return json({ error: `OpenRouter error ${response.status}: ${body}` }, 502);
    }

    const data = await response.json();
    const text: string = data?.choices?.[0]?.message?.content?.trim() ?? '';

    if (!text) {
      lastError = `Model "${model}" returned an empty response.`;
      continue;
    }

    // Return the raw text — parseJsonFromModel() in aiService.js handles the rest.
    return json({ text });
  }

  const details = failedModels.length > 0 ? ` Attempts: ${failedModels.join(', ')}.` : '';
  return json({
    error: `${lastError}${details} The Edge Function is reachable, but OpenRouter did not return a usable model for this API key. Check the key's privacy/model access and credits in the OpenRouter playground, or set OPENROUTER_MODEL to a currently available model ID.`,
  }, 503);
});
