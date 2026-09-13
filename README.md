# Fertility Marketplace — Backend (MVP Starter)

Node + Express + TypeScript API for the Verified Fertility Donor Marketplace.
Built directly from the PRD's 11 functional modules and the companion UX/Design System doc.

## Stack
- Express + TypeScript
- PostgreSQL via a raw `pg` `Pool` (no ORM) — hand-written SQL migrations + seeds, tracked in a `schema_migrations` table
- JWT auth (short-lived access token + rotating refresh token)
- Nodemailer/SMTP for verification + password-reset email
- Deployable to Vercel as a single serverless function, or run standalone with `npm run dev`

## What's real vs. mocked
| Area | Status |
|---|---|
| Auth (register/login/refresh/verify-email/reset-password) | **Fully implemented** |
| Donor profile builder, visibility toggles, anonymity preference | **Fully implemented** |
| Recipient search & filter, shortlist | **Fully implemented** |
| Identity verification (KYC) | **Mocked** — `KYC_MOCK_MODE=true` auto-approves; swap `verification.routes.ts`'s decision block for a real provider (Persona/Onfido/Stripe Identity) |
| Medical & genetic screening | Intake + clinic determination **real**; genetic-lab results are a **mocked** pass-through |
| Messaging | **Fully implemented**, including a regex-based contact-detail redaction pre-consent and a mutual-consent unlock |
| Consent & legal agreements | **Fully implemented** (e-signature + version history); agreement text itself is placeholder copy — needs counsel review |
| Transactions & escrow | Jurisdiction cap + milestone confirm/release flow **real**; the payment/escrow provider call itself is **mocked** (`ESCROW_MOCK_MODE=true`) |
| Disputes | **Fully implemented** |
| Jurisdiction & eligibility rules engine | **Fully implemented** — data-driven via the `jurisdictions` table, plus an ethics-review escalation queue |
| Trust & Safety | **Fully implemented** — flag queue, profile suspend/reinstate |
| Clinic Partner Portal | **Fully implemented**, including a break-glass access log for medical-data reads |
| Admin Console | **Fully implemented** — unified case queue, user directory, audit log viewer |

Every module route file has inline comments pointing at exactly where to swap a mock for a real integration.

## Getting started

```bash
cp .env.example .env      # then fill in DATABASE_URL, JWT secrets, SMTP creds
npm install
npm run migrate           # applies all migrations
npm run seed               # optional: demo jurisdictions + one user per role (password: DemoPass123!)
npm run dev                 # local dev server on http://localhost:4000
```

All routes are namespaced under `API_BASE_PATH` (default `/api/v1`), e.g. `POST /api/v1/auth/register`.

## Migrations

Plain SQL, paired `NNNN_name.up.sql` / `NNNN_name.down.sql` files in `/migrations`, applied in filename order and tracked in `schema_migrations`.

```bash
npm run migrate           # apply all pending
npm run migrate:down      # revert the most recently applied migration
npm run migrate:status    # list applied/pending
```

## Deploying to Vercel

This repo is set up to deploy as-is:

1. Push to a Git repo, import into Vercel.
2. Set environment variables in the Vercel dashboard (everything in `.env.example`) — for `DATABASE_URL`, use a **pooled** connection string (e.g. Neon's pooled URL, or Supabase's port-6543 transaction pooler), since each function invocation opens a fresh `pg.Pool`.
3. Deploy. `vercel.json` routes all traffic through `api/index.ts`, which wraps the Express app with `serverless-http`.
4. Run `npm run migrate` (and optionally `npm run seed`) once, pointed at the production `DATABASE_URL`, from your machine or a one-off script — Vercel doesn't run build-time migrations automatically.

## Auth flow summary
- `POST /auth/register` → creates user (+ donor_profile row if role=donor), sends verification email
- `POST /auth/login` → returns `{ accessToken, refreshToken, user }`
- `POST /auth/refresh` → rotates refresh token, returns a new pair
- `POST /auth/logout` → revokes the given refresh token
- All protected routes expect `Authorization: Bearer <accessToken>`

## Roles
`donor`, `recipient`, `clinic_staff`, `admin`, `ethics_reviewer` — enforced via `requireRole()` middleware per route.
