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

## 5. Connect the website to Supabase

1. **Dashboard → Project Settings → API**.
2. Copy the **Project URL** and the **`anon` `public`** key.
3. Open [`admin/config.js`](admin/config.js) and paste them in:

   ```js
   window.SUPABASE_CONFIG = {
     url: "https://tvmhycdyfflnxrnpvhjf.supabase.co",   // already filled in
     anonKey: "eyJhbGciOi...your anon public key..."     // paste here
   };
   ```

## 6. Test locally

```bash
python -m http.server 4173
# visit http://localhost:4173/admin/  and sign in
```

You should see the dashboard, be able to add an entry, and see it appear in the
Supabase **Table Editor → transactions**.

## 7. Deploy

Push to GitHub → Vercel auto-deploys. The portal will live at
`https://your-domain/admin/`. It is marked `noindex` and is not linked from the
public site, so visitors won't find it — but access is ultimately protected by
the login + database rules, not by hiding the URL.

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
