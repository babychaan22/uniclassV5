// supabase/functions/gemini-proxy/index.ts
//
// Proxies Gemini API calls so the API key never reaches the browser.
// Used as a fallback when OpenRouter's free models are all exhausted.
//
// Deploy:
//   supabase functions deploy gemini-proxy
//
// Set the secret (Google AI Studio API key):
//   supabase secrets set GEMINI_API_KEY=sk-...
//
// Optional: override the model (default: gemini-2.5-flash):
//   supabase secrets set GEMINI_MODEL=gemini-2.5-flash

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CONFIGURED_MODEL = Deno.env.get('GEMINI_MODEL') ?? '';

const SYSTEM_PROMPT =
  'You are a precise assistant that replies with ONLY valid JSON. ' +
  'No markdown code fences, no prose before or after the JSON object.';

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

async function getModelChain(apiKey: string): Promise<string[]> {
  const models: string[] = CONFIGURED_MODEL ? [CONFIGURED_MODEL] : [];
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (response.ok) {
      const data = await response.json();
      const discovered = (data?.models ?? [])
        .filter((model: { name?: string; supportedGenerationMethods?: string[] }) =>
          model.name && model.supportedGenerationMethods?.includes('generateContent'))
        .map((model: { name: string }) => model.name.replace(/^models\//, ''))
        .filter((name: string) => /flash/i.test(name) && !/embedding|image|tts/i.test(name));
      models.push(...discovered);
    }
  } catch {
    // The configured model can still be attempted when model discovery fails.
  }
  return [...new Set(models)].slice(0, 8);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return json(
      { error: 'Gemini API key not configured on the server. Run: supabase secrets set GEMINI_API_KEY=sk-...' },
      500,
    );
  }

  let prompt: string;
  try {
    ({ prompt } = await req.json());
  } catch {
    return json({ error: 'Request body must be JSON with a "prompt" field.' }, 400);
  }
  if (!prompt) {
    return json({ error: '"prompt" is required.' }, 400);
  }
  if (typeof prompt !== 'string' || prompt.length > 12000) {
    return json({ error: 'Prompt is too long.' }, 413);
  }

  const modelChain = await getModelChain(apiKey);
  let lastError = 'No Gemini model with generateContent is available for this API key.';
  for (const model of modelChain) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      lastError = `Gemini model ${model} returned HTTP ${response.status}: ${await response.text()}`;
      if ([400, 404, 429, 500, 502, 503].includes(response.status)) continue;
      return json({ error: lastError }, 502);
    }

    const data = await response.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    if (!text) { lastError = `Gemini model ${model} returned an empty response.`; continue; }

    return json({ text });
  }
  return json({ error: `${lastError} Check GEMINI_API_KEY and GEMINI_MODEL in Supabase secrets.` }, 503);
});
