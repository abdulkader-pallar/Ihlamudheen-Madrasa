-- ============================================================================
--  OAuth hardening migration — "registered users only"
--  Run this in Supabase → SQL Editor AFTER the original schema.sql.
--
--  Effect: any brand-new account (including Google / Apple sign-ins) is created
--  with the role 'pending', which has NO access. Only an admin promoting them to
--  admin / accountant / viewer grants access. Unregistered accounts stay locked out.
--
--  ⚠️  YOU MUST RUN THIS AS TWO SEPARATE QUERIES ⚠️
--  Postgres won't let a new enum value be USED in the same transaction it's added,
--  and the SQL Editor runs a whole script as one transaction. So:
--    1. Paste ONLY the STEP 1 line below, press Run, wait for "Success".
--    2. THEN paste the STEP 2 block into a new query and press Run.
--  (Running the whole file at once fails with: 55P04 unsafe use of new value "pending".)
-- ============================================================================


-- ####  STEP 1  ####  Run this line ALONE first, then stop. ####################
alter type public.user_role add value if not exists 'pending';


-- ####  STEP 2  ####  Run this block ONLY AFTER Step 1 succeeded. ##############
alter table public.profiles alter column role set default 'pending';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'pending')
  on conflict (id) do nothing;
  return new;
end $$;

-- Existing admins/accountants/viewers are unaffected — this only changes the
-- default for accounts created from now on.
