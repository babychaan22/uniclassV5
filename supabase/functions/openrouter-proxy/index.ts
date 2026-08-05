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
// Optional: pin the first model tried (falls through to the chain below
// if unavailable):
//   supabase secrets set OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1:free

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Fallback chain — tried in order. Update from https://openrouter.ai/models?max_price=0
const FREE_MODEL_CHAIN: string[] = [
  Deno.env.get('OPENROUTER_MODEL') ?? '',
  'deepseek/deepseek-chat-v3.1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-235b-a22b:free',
  'google/gemini-2.0-flash-exp:free',
  'openrouter/free', // OpenRouter's own auto-router as last resort
].filter(Boolean);

const CORS_HEADERS = {
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
  try {
    ({ prompt } = await req.json());
  } catch {
    return json({ error: 'Request body must be JSON with a "prompt" field.' }, 400);
  }
  if (!prompt) {
    return json({ error: '"prompt" is required.' }, 400);
  }

  // ── Model fallback chain ────────────────────────────────────────────────────
  let lastError = 'All free OpenRouter models are currently unavailable. Try again shortly.';

  for (const model of FREE_MODEL_CHAIN) {
    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://uniclass.app',
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

  return json({ error: lastError }, 503);
});
