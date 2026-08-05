@echo off
REM Deploy edge functions to Supabase
REM Edit the API keys below before running.

cd /d "C:\Users\kthlr\Downloads\uniclass-v5 (1)\project"

REM --- Link to project (run once) ---
supabase login
supabase link --project-ref rqvrndkhjrammmsdrinz

REM --- Set secrets (server-side only) ---
supabase secrets set OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY_HERE
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY_HERE

REM --- Optional: override models ---
REM supabase secrets set OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1:free
REM supabase secrets set GEMINI_MODEL=gemini-1.5-flash

REM --- Deploy functions ---
supabase functions deploy openrouter-proxy
supabase functions deploy gemini-proxy

echo.
echo Deployment complete.
