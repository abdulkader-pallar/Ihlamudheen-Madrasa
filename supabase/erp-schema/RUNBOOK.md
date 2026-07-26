# ERP Schema Runbook — apply carefully, STAGING FIRST

This folder holds the database schema for the migrated ERP features (students,
classes, teachers, attendance, exams, fees, payroll, timetables, fest/meelad,
lesson plans, session proofs, etc.). It was ported from the reference project
with all branding and real people removed.

> ⚠️ **Do NOT run these blindly against your live accounting database.**
> Your accounting tables (`profiles`, `categories`, `funds`, `transactions`,
> `staff`, `attendance`) already exist and hold real data. These migrations ADD
> new tables, but a few touch shared objects. Apply to a **staging copy first**,
> verify accounting still works, then apply to production.

## What was excluded (do not re-add)
- `migration-app-data.sql` — real student/class roster (personal data). **Excluded.**
- `schema.sql` — a stale base (`users/courses/enrollments/…`) that conflicts with
  your accounting `profiles` and its `handle_new_user` trigger. **Excluded.**
- The teacher/assignment SEED in `migration-staff-payments.sql` — real staff.
  Removed; the table DDL is kept.

## The one real conflict to resolve — `handle_new_user` / `on_auth_user_created`
Both your accounting schema and some of these files define a trigger on
`auth.users`. Your accounting version inserts a `profiles` row (role `pending`).
**Keep YOUR version.** Before applying, review any file that recreates
`handle_new_user` or `on_auth_user_created` and either skip that statement or
merge its intent into your existing function. Do not let it overwrite the
profiles-based trigger, or new sign-ups will stop getting a profile row.

## Role model note
The reference ERP reads roles from auth **`app_metadata.role`** (values
`admin/accountant/teacher/student`), not from a DB enum — so there is **no
`user_role` enum conflict** with your accounting `viewer/pending` enum. For ERP
RLS to grant access, users must have `app_metadata.role` set (the
`/api/auth/verify-user` route does this from its allow-list — populate it with
your own staff). Your accounting RLS (`is_editor`, `current_user_role`,
`is_member`) is untouched and keeps working.

## Suggested apply order (CORRECTED)
1. **`00-base-app-tables.sql` FIRST** — creates classes, students, attendance,
   exams, exam_subjects, exam_scores (the core tables the app queries). This DDL
   was extracted from the reference project's data file; the real roster seed was
   dropped.
2. The remaining root `migration-*.sql` files (staff-payments, monthly-salaries,
   marked-by, attendance-requests, lms-notes, storage-photos, profile-fields…).
3. Then `migrations/*.sql` in **timestamp order** (filenames sort correctly).

## ⛔ Quarantined — `_review-do-not-run-as-is/`
`migration-security-hardening.sql`, `-part-a`, `-part-b` were moved out of the run
set. They **recreate `profiles` + `handle_new_user` + `on_auth_user_created`** with
the reference project's model and would **overwrite your accounting auth** (which
already creates a `profiles` row with role `pending`). The ERP tables don't need
them — their RLS policies check the role inline. Do NOT run these as-is; port only
anything you specifically need, by hand.

## ⚠️ Role source — verify on staging
The ERP table policies grant WRITE via `auth.jwt() -> 'user_metadata' ->> 'role'`
(`admin`/`teacher`), but your sign-in flow (`/api/auth/verify-user`) stamps the role
into **`app_metadata.role`**. So a user may be able to READ ERP data but not WRITE
it until their role is also in `user_metadata`, OR the policies are changed to read
`app_metadata`. Decide one approach and apply it consistently while testing on staging.

## Procedure
1. In the Supabase dashboard, create a **branch / staging project** (or a DB copy).
2. Apply the files in the order above via the SQL editor. Watch for errors —
   some later migrations depend on earlier ones.
3. When you hit the `handle_new_user`/trigger statements, handle per the note above.
4. Verify: sign in, confirm `/admin` accounting (transactions/reports) still works,
   then confirm the new `/dashboard` ERP pages load without table errors.
5. Only after staging is clean, apply the same, in the same order, to production.

## After the schema is live
- Populate `app/api/auth/verify-user/route.ts` and `app/api/setup-teachers/route.ts`
  AUTHORIZED / ACCOUNTS_TO_CREATE with your own staff emails.
- Enter your real courses, classes, students, and staff through the app (the
  seed data files were intentionally left empty).
