# Ihlamudheen Madrasa

Two things live in this repo:

1. **Public website** (`index.html`) — the marketing site for **Ihlamudheen
   Madrasa** (مدرسة إعلام الدين): About, Programs, Admissions, Contact.
2. **Private accounting portal** (`admin/`) — a secure, login-only app for
   recording the institution's **income & expenditure**, backed by Supabase.

The primary purpose of the project is the accounting portal; the public site is
the front-facing brochure. Brand colours: navy · teal · gold.

> ⚠️ **Financial data is sensitive.** The accounting portal is protected by
> Supabase Auth + Postgres Row Level Security. See [`SETUP.md`](SETUP.md) before
> going live, and never commit the Supabase `service_role` secret key.

---

## 🔗 Working spaces

| Service   | Purpose                     | Link |
|-----------|-----------------------------|------|
| GitHub    | Source code repository      | https://github.com/abdulkader-pallar/Ihlamudheen-Madrasa |
| Vercel    | Hosting / deployment (admin)| https://vercel.com/ihlamudheen-madrasa/ihlamudheen-madrasa |
| Supabase  | Database / backend (admin)  | https://supabase.com/dashboard/project/tvmhycdyfflnxrnpvhjf |

> ⚠️ The Vercel and Supabase links are **private admin dashboards** and must not
> be published on the public website.

---

## Project structure

```
.
├── index.html                 # Public marketing website (HTML + inline CSS/JS)
├── admin/                     # Private accounting portal
│   ├── index.html             #   app shell + styles
│   ├── app.js                 #   logic (auth, dashboard, CRUD, reports)
│   └── config.js              #   PUBLIC Supabase url + anon key (paste yours)
├── supabase/
│   └── schema.sql             # Database tables, RLS, roles, seed data
├── public/                    # Brand assets (logos)
├── SETUP.md                   # Step-by-step accounting-portal setup
└── README.md
```

## Accounting portal

- Lives at `/admin/` — login required, not linked from the public site.
- **Roles:** `admin` / `accountant` (full edit) and `viewer` (read-only reports).
- **Features:** income & expense entries, live dashboard with charts, categories
  & funds, and reports with CSV / print-to-PDF export.
- **Setup:** follow [`SETUP.md`](SETUP.md) — run `supabase/schema.sql`, disable
  public sign-ups, create users, assign roles, paste the anon key into
  `admin/config.js`.

## Local development

Open `index.html` directly in a browser, or serve the folder:

```bash
python -m http.server 4173
# then visit http://localhost:4173
```

## Fonts

- **Fraunces** & **Hanken Grotesk** — loaded from Google Fonts (English UI/display).
- **Andalus** — Arabic text (a system font on Windows); falls back to **Amiri**
  (Google Fonts) on devices without it.

## Deployment (Vercel)

The site is static, so Vercel serves `index.html` as-is. Pushing to the `main`
branch of the GitHub repo triggers an automatic deployment.

## Backend (Supabase) — planned

The admission enquiry form currently opens the visitor's email client. It can be
wired to store submissions in Supabase instead. See the "Next steps" below.

## Next steps

- [ ] Run `supabase/schema.sql` and complete [`SETUP.md`](SETUP.md).
- [ ] Paste the Supabase **anon** key into `admin/config.js`.
- [ ] `git init` locally and push to the GitHub repo.
- [ ] Connect the GitHub repo to Vercel for automatic deploys.
- [ ] Replace placeholder contact details on the public site (phone, email, address).
