# Ihlamudheen Madrasa — Accounts Portal Setup

This guide gets the private accounting portal (`/admin/`) running securely on top
of your existing Supabase + Vercel projects. Follow it once; it takes ~15 minutes.

> **Golden rule:** the **public "anon" key** is the only Supabase key that ships to
> the browser. The **`service_role` / secret key** is used only by server-side API
> routes (adding users, receiving device punches) — keep it in `.env.local` / Vercel
> env vars and never paste it into client code or a chat.

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

Two ways to add a login account:

- **From the website (easiest):** sign in as the super-admin
  (`cryptolife676@gmail.com`) → **Users & Roles → Add a user**. Set name, email,
  a temporary password, and the role; they can sign in immediately. This requires
  the service-role secret to be set (see [§8](#8-adding-users--staff-attendance-zkteco)).
- **From Supabase:** **Dashboard → Authentication → Users → Add user** (email + a
  strong password). New users get the **`pending`** role until an admin assigns one
  in **Users & Roles**.

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

## 8. Adding users & staff attendance (ZKTeco)

These two features need **two server-only secrets**. Set them in `.env.local`
(local dev) **and** in **Vercel → Settings → Environment Variables** (Production +
Preview). Never expose them to the browser.

| Env var | What it's for | Where to get it |
|---------|---------------|-----------------|
| `SUPABASE_SERVICE_ROLE_KEY`* | Create login accounts from the website; write device punches | Supabase → Project Settings → API → `service_role` secret |
| `ZK_API_KEY` | Shared password between the ZKTeco agent and the website | Any long random string you choose |

\* This project also accepts the existing name `NEXT_SECRET_SUPABASE_SECRET_KEY` —
either works.

**Set up attendance:**

1. Run [`supabase/staff-attendance.sql`](supabase/staff-attendance.sql) in the
   **SQL Editor** (creates the `staff` and `attendance` tables + RLS). Safe to re-run.
2. In the website, go to **Staff Attendance → Manage staff** and add each teacher /
   employee. Set their **Device user id** to the enrolment number the ZKTeco device
   shows for that person.
3. Put [`zk_agent.py`](zk_agent.py) on the **office PC** (same network as the device):
   ```bash
   pip install pyzk requests
   ```
   Edit the top of the file: set `DEVICE_IP` (the device's IP) and `ZK_API_KEY`
   (same value as the Vercel env var). Run `python zk_agent.py`. To run it
   automatically, add it as a Windows **Scheduled Task** at log-on (use `pythonw.exe`
   to run silently). See the comments inside the file.
4. Punches now flow: **device → agent → `/api/zk-attendance` → Supabase**, and each
   staff member's in/out time shows on the **Dashboard** and **Staff Attendance** page.
   The first punch of the day is the check-in; a later punch becomes the check-out.
   Editors can also enter or correct times by hand on the Attendance page.

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
