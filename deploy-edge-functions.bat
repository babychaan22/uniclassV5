@echo off
REM Deploy edge functions to Supabase
REM Edit the API keys below before running.

cd /d "%~dp0"

REM --- Link to project (run once) ---
supabase login
supabase link --project-ref YOUR_PROJECT_REF

REM --- Set secrets (server-side only) ---
supabase secrets set OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY_HERE
supabase secrets set OPENROUTER_MODEL=openrouter/free
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY_HERE
supabase secrets set GEMINI_MODEL=gemini-2.5-flash
supabase secrets set APP_ORIGIN=http://localhost:5173

REM --- Optional: override models ---
REM supabase secrets set OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1:free
REM supabase secrets set GEMINI_MODEL=gemini-1.5-flash

REM --- Deploy functions ---
supabase functions deploy openrouter-proxy
supabase functions deploy gemini-proxy

echo.
echo Deployment complete.
