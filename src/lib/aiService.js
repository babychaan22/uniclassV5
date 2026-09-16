// src/lib/aiService.js
//
// AI service — routes through the `openrouter-proxy` Supabase Edge Function
// so the OpenRouter API key never reaches the browser bundle.
//
// Falls back to the `gemini-proxy` Edge Function (calling Google's Gemini
// API directly) when OpenRouter's free models are all exhausted or unavailable.
//
// Keys live in Supabase Vault (server-side only):
//   supabase secrets set OPENROUTER_API_KEY=sk-or-...
//   supabase secrets set GEMINI_API_KEY=sk-...

import { supabase } from '@/api/supabaseClient';

/**
 * Ask the AI to return a JSON response.
 * Identical call-site API to the old direct-OpenRouter version — every page
 * that calls `invokeLLM({ prompt })` continues to work without changes.
 *
 * @param {Object} args
 * @param {string} args.prompt - Prompt that instructs the model to return JSON.
 * @returns {Promise<Object>} Parsed JSON object from the model.
 */
export async function invokeLLM({ prompt }) {
  const errors = [];

  const providers = [
    { name: 'openrouter-proxy', label: 'OpenRouter' },
    // Gemini fallback is opt-in because model availability varies by account.
    ...(import.meta.env.VITE_ENABLE_GEMINI_FALLBACK === 'true'
      ? [{ name: 'gemini-proxy', label: 'Gemini' }]
      : []),
  ];

  for (const provider of providers) {
    try {
      const { data, error } = await supabase.functions.invoke(provider.name, {
        body: { prompt },
      });

      if (error) {
        let detail = '';
        try {
          const body = await error.context?.json();
          detail = body?.error ? `: ${body.error}` : '';
        } catch {}
        errors.push(`${provider.label} error: ${error.message}${detail}`);
        continue;
      }

      if (data?.error) {
        errors.push(`${provider.label}: ${data.error}`);
        continue;
      }

      if (!data?.text) {
        errors.push(`${provider.label} returned an empty response.`);
        continue;
      }

      return parseJsonFromModel(data.text);
    } catch (err) {
      errors.push(`${provider.label}: ${err.message}`);
      continue;
    }
  }

  throw new Error(errors.join(' | ') || 'All AI models are currently unavailable. Try again shortly.');
}

/** Strip markdown fences and parse JSON, with a fallback regex extraction. */
function parseJsonFromModel(text) {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    throw new Error("The AI response wasn't valid JSON. Try again or simplify the topic.");
  }
}
