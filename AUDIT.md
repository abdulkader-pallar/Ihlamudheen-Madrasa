# AUDIT PROMPT — Ihlamudheen Madrasa Website & Accounts Portal

You are a senior full-stack auditor. Perform a thorough, adversarial audit of this
project from EVERY angle and report findings ranked by severity. Do not assume the
code is correct — try to break it.

## Project context
- **Two parts in one Next.js app:** (1) a PUBLIC marketing site (`app/page.tsx`) and
  (2) a PRIVATE accounting portal (`app/admin/*`) that records the institution's
  income & expenditure. The accounting data is financially sensitive.
- **Stack:** Next.js 15 (App Router, TypeScript, Tailwind), React 18, Supabase
  (Postgres + Auth), deployed on Vercel (auto-deploy from a PUBLIC GitHub repo).
- **Auth:** email/password + Google/Apple OAuth via `@supabase/ssr`. There is NO
  Next.js middleware — auth is enforced in the force-dynamic server layout
  (`app/admin/layout.tsx`) and the OAuth callback (`app/auth/callback/route.ts`).
- **Roles:** admin, accountant, viewer, pending. `pending` (and no-profile) = NO
  access. Access rule lives in `lib/types.ts` (`hasAccess`). New sign-ups default
  to `pending`; admins promote via the Users & Roles screen.
- **DB security:** Row Level Security on every table (`supabase/schema.sql`), plus
  `supabase/oauth-migration.sql`. Only `authenticated` members can read; only
  admin/accountant can write. `anon` gets nothing.
- Currency is INR (₹). Config in `lib/supabase/config.ts` (public URL + anon key only).

## Audit these dimensions — for each, list concrete findings

### 1. Authentication & Authorization (HIGHEST PRIORITY)
- Can an UNREGISTERED Google/Apple user gain ANY access? Trace the full OAuth flow
  (`signInWithOAuth` -> `/auth/callback` -> `hasAccess` gate -> layout re-check). Find
  any path where a `pending`/no-profile user reaches data or a protected page.
- Can a `viewer` perform writes (insert/update/delete) via the UI OR by calling
  Supabase REST directly with their JWT? Verify RLS actually blocks it, not just the UI.
- Is every `/admin/*` route protected server-side on every request? Check for any
  route/segment that renders before the layout auth check, or any client-only guard.
- Session handling: token refresh without middleware — can a session be fixated,
  replayed, or does an expired token silently grant access? Check the last-admin
  demotion guard on the Users screen for bypasses.

### 2. Data security & RLS correctness
- Re-derive each RLS policy in `schema.sql`. Can `anon` read/write ANY table? Confirm
  by reasoning about the GRANTs + policies together (a missing GRANT vs a missing policy).
- Are the SECURITY DEFINER functions (`current_user_role`, `is_editor`, `is_member`)
  injectable or exploitable (search_path, privilege escalation)? Can a non-admin
  update their own `profiles.role`?
- Can one user read/modify another's rows? Is `created_by`/`updated_by` spoofable?
- Verify the audit trail (who created/updated each transaction) can't be forged.

### 3. Secrets & configuration
- Scan the ENTIRE repo (it's PUBLIC on GitHub) for any leaked secret: service_role
  key, DB password, `POSTGRES_*`, JWT secret, private tokens. Check committed files,
  `.env*`, config, and git history.
- Confirm only the public URL + anon/publishable key are shipped to the browser.
  Verify `.gitignore` covers `.env.local`. Flag any `NEXT_SECRET_*` that could reach
  the client.

### 4. Input validation & injection
- Amount/date/text inputs on transactions, categories, funds, enquiry form: test
  negative/zero/huge/NaN amounts, XSS payloads in descriptions, SQL/PostgREST
  filter injection, and unicode/RTL edge cases. Is anything rendered with
  `dangerouslySetInnerHTML`?
- CSV/print export: formula injection (`=`, `+`, `@`, `-` prefixes) in exported cells?

### 5. Financial correctness
- Verify the accounting math: totals, balance (income - expense), per-month/category
  aggregations, rounding of INR amounts, timezone handling of dates. Find off-by-one,
  float-rounding, or filter-vs-total mismatches. Do reports and dashboard agree?

### 6. Performance & scalability
- N+1 queries, unindexed filters, loading all rows client-side, chart re-renders,
  bundle size, image sizes (the logo PNGs), and behavior at 10k+ transactions.

### 7. Accessibility (WCAG AA)
- Color contrast in BOTH themes, focus-visible states, keyboard nav (menus, modals,
  apps launcher), form labels/aria, heading order, alt text, reduced-motion.

### 8. Responsive & cross-browser
- Test 360px -> 1440px. Check the auto-fit hero headline, the admin sidebar/topbar,
  tables overflow, modals, RTL Arabic rendering, dark/light on Safari/Firefox/Chrome.

### 9. SEO & metadata (public site only)
- Title/description/OpenGraph, semantic HTML, `noindex` correctly set on `/admin` and
  `/login`, robots, favicon, lang attributes.

### 10. Reliability, errors & DR
- Error handling: does a Supabase outage or missing env var 500 the whole site, or
  degrade gracefully? (Recall a prior MIDDLEWARE_INVOCATION_FAILED incident.)
- Backups: is point-in-time recovery / daily backup enabled? What's the data-loss
  window? Confirm the free-tier 7-day inactivity pause risk is understood.

### 11. Deployment & infra hygiene
- Confirm the deployed app points to the CORRECT Supabase project (`iiathuvpstbqrtsskppq`),
  not the stray `zozvkulpobybnhcstvtl`. Flag the active Vercel<->Supabase Marketplace
  integration as a risk of env-var drift. Check Vercel Deployment Protection is off
  for the public site but the app's own auth is intact.

### 12. Privacy & compliance
- Financial + personal data handling, the enquiry form's data path, cookie/consent
  needs, and least-privilege access.

## Output format
For each finding provide:
- **Severity:** Critical / High / Medium / Low / Info
- **Area** (from the list above)
- **What & where:** the file/line or flow, and a concrete exploit or failure scenario
- **Evidence:** how you confirmed it
- **Fix:** specific, minimal remediation

End with: (a) a prioritized top-10 remediation list, and (b) an overall risk rating
with the single most important thing to fix first. Verify each claim before reporting;
mark anything unconfirmed as "PLAUSIBLE" vs "CONFIRMED".
