// Runs the E2E seeder with the right environment loaded, so a full mobile
// regression can never silently run against one-shot fixtures that an
// earlier run already consumed (missions, gacha, transfers).
// Usage: node tests/run-e2e-seed.mjs   (equivalent to npm run test:e2e:seed)
try { process.loadEnvFile('.env.e2e'); } catch { /* CI supplies values */ }
process.env.TEST_E2E_SEED = '1';
await import('./seed-e2e-data.mjs');
