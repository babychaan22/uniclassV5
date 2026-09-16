# P0 release checklist

## Dedicated mobile test data

The repository includes `npm run test:e2e:seed`. Run it only against a test Supabase project or with dedicated `@example.test` users. It requires `TEST_E2E_SEED=1`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, and `TEST_E2E_PASSWORD`.

Use separate test accounts, not personal accounts. The test student must have:

- one active mission;
- one editable activity with an evidence upload path;
- two approved class memberships for class switching.

The test teacher must own a classroom with activity logs, evidence, and exportable data.

Set `TEST_E2E_STRICT=1` when validating release readiness. In strict mode, missing test data fails the scenario instead of silently skipping it.

## Database deployment

Deploy `supabase/migrations/20260925_atomic_classroom_setup.sql` before using teacher class setup. It adds the `create_classroom` RPC, which creates the classroom, groups, and settings in one transaction.

After deployment, verify:

1. A grouped class creates the requested number of groups.
2. An individual class creates zero groups.
3. A forced settings failure rolls back the classroom and groups.
4. A student cannot execute the RPC.

## Credentials

Rotate any API keys and passwords previously pasted into chat or terminals. Store test credentials only in local environment variables or CI secrets.
