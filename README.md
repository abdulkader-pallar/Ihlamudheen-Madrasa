# Ihlamudheen Madrasa

A modern **Next.js 15** app for **Ihlamudheen Madrasa** (مدرسة إعلام الدين), an
Islamic education institute. It contains two things:

1. **Public website** (`/`) — the marketing site: hero, about, programs,
   admissions, contact.
2. **Private accounting portal** (`/admin`) — a secure, login-only app for the
   institution's **income & expenditure**, backed by Supabase.

The accounting portal is the primary purpose; the public site is the front-facing
brochure. Brand colours: navy · teal · gold.

## Tech stack

| Layer      | Choice |
|------------|--------|
| Framework  | Next.js 15 (App Router) + TypeScript + React 18 |
| Styling    | Tailwind CSS (theme via CSS variables, light/dark) |
| Auth       | Supabase Auth via `@supabase/ssr` — **httpOnly cookies, validated server-side** |
| Data       | Supabase Postgres with **Row Level Security** |
| Charts     | Recharts · Icons: lucide-react |
| Hosting    | Vercel |

> ⚠️ **Financial data is sensitive.** Access is protected by middleware
> (server-side route guard), Supabase Auth, and Postgres Row Level Security.
> See [`SETUP.md`](SETUP.md) before going live. Never commit the Supabase
> `service_role` secret — only the public `anon` key ships to the browser.

## Project structure

```
app/
  layout.tsx              # fonts, metadata, theme bootstrap
  page.tsx                # public marketing site
  login/page.tsx          # staff sign-in
  admin/
    layout.tsx            # server-side auth + role check (protected)
    page.tsx              # dashboard (stats + charts)
    transactions/page.tsx # income/expense CRUD + filters + CSV
    reports/page.tsx      # statements + print/PDF + CSV
    manage/page.tsx       # categories & funds
components/
  ui/                     # theme toggle, toast
  admin/                  # shell, data provider, charts, dialogs
lib/
  supabase/               # browser + server clients, session middleware
  types.ts, format.ts, csv.ts, ui.ts
middleware.ts             # refreshes session + guards /admin
supabase/schema.sql       # tables, RLS, roles, audit, seed data
public/                   # logos
legacy-static/            # the previous plain-HTML version (kept for reference)
```

## Local development

```bash
npm install
cp .env.example .env.local     # then paste your Supabase anon key
npm run dev                    # http://localhost:3000
```

The public site works immediately. The `/admin` portal needs Supabase configured
(see below) — until then the login page shows a "not configured" notice.

## Accounting portal

- Lives at `/admin` — login required, `noindex`, not linked from the public site.
- **Roles:** `admin` / `accountant` (full edit) and `viewer` (read-only reports).
- **Features:** income & expense entries, live dashboard with charts, categories
  & funds, and reports with CSV / print-to-PDF export.

## Setup & deploy

Follow [`SETUP.md`](SETUP.md): run `supabase/schema.sql`, disable public
sign-ups, create users, assign roles, set the env vars, deploy to Vercel.
