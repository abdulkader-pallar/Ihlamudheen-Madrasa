# Ihlamudheen Madrasa — Accounts Portal Setup

This guide gets the private accounting portal (`/admin/`) running securely on top
of your existing Supabase + Vercel projects. Follow it once; it takes ~15 minutes.

> **Golden rule:** only ever use the **public "anon" key** in the website.
> Never paste the **`service_role` / secret key** into any file or into a chat.

---

## 1. Create the database

1. Open your project → **Supabase Dashboard → SQL Editor → New query**.
2. Open [`supabase/schema.sql`](supabase/schema.sql), copy **all** of it, paste it in, and click **Run**.
   - This creates the `profiles`, `categories`, `funds`, and `transactions` tables,
     turns on **Row Level Security**, sets up the three roles, and seeds all the
     madrasa income/expense categories and common funds.
   - It is safe to re-run if needed.

## 2. Lock down sign-ups (invite-only)

1. **Dashboard → Authentication → Providers → Email**.
2. Turn **OFF** "Allow new users to sign up". (Only people you add can get in.)
3. Optional but recommended: turn **ON** "Confirm email".

## 3. Create the staff accounts

1. **Dashboard → Authentication → Users → Add user** (set an email + a strong password).
2. Repeat for each staff member (accountants, viewers).
   - Every new user automatically gets a profile with the **`viewer`** role (read-only).

## 4. Assign roles

Run this in the **SQL Editor**, changing the email each time:

```sql
-- make yourself the admin
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');

-- give an accountant full add/edit rights
update public.profiles set role = 'accountant'
where id = (select id from auth.users where email = 'accountant@example.com');

-- trustees stay 'viewer' (the default) — they can view reports but not edit
```

| Role         | Can view | Can add/edit/delete | Manage categories & funds |
|--------------|:--------:|:-------------------:|:-------------------------:|
| `admin`      | ✅       | ✅                  | ✅                        |
| `accountant` | ✅       | ✅                  | ✅                        |
| `viewer`     | ✅       | ❌                  | ❌                        |

## 5. Connect the app to Supabase (env vars)

1. **Dashboard → Project Settings → API**.
2. Copy the **Project URL** and the **`anon` `public`** key.
3. Create `.env.local` (copy from [`.env.example`](.env.example)) and fill it in:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://iiathuvpstbqrtsskppq.supabase.co   # already set
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...your anon public key...   # paste here
   ```

   Only these PUBLIC values live in the app. The `service_role` secret is never used here.

## 6. Test locally

```bash
npm install
npm run dev
# visit http://localhost:3000/admin  and sign in
```

You should see the dashboard, be able to add an entry, and see it appear in the
Supabase **Table Editor → transactions**.

## 7. Deploy to Vercel

1. Push to GitHub → import the repo in Vercel (Next.js is auto-detected).
2. In **Vercel → Project → Settings → Environment Variables**, add the same two
   `NEXT_PUBLIC_SUPABASE_*` values (Production + Preview).
3. Deploy. The portal lives at `https://your-domain/admin`.

Access is protected by **server-side middleware + Supabase Auth + Row Level
Security** — not by hiding the URL. The `/admin` routes are also marked
`noindex`.

---

## Security summary

- **Login required** for every screen (Supabase Auth).
- **Row Level Security** in Postgres: the database itself rejects any read/write
  from anyone who isn't a signed-in staff member with the right role — even if the
  public key is known.
- **No secrets in the browser** — only the public anon key ships.
- **HTTPS** everywhere (Vercel) and **daily automatic backups** (Supabase).
- **Audit trail** — each transaction stores who created/updated it and when.

### Extra hardening (optional, recommended)
- Supabase **Dashboard → Database → Backups**: confirm daily backups (or enable
  Point-in-Time Recovery on paid plans).
- Ask staff to use long, unique passwords; consider enabling MFA if available.
- Keep the number of `admin`/`accountant` accounts small.
