-- ============================================================================
--  OAuth hardening migration — "registered users only"
--  Run this in Supabase → SQL Editor AFTER the original schema.sql.
--
--  Effect: any brand-new account (including Google / Apple sign-ins) is created
--  with the role 'pending', which has NO access. Only an admin promoting them to
--  admin / accountant / viewer grants access. Unregistered accounts stay locked out.
--
--  IMPORTANT: run STEP 1 on its own first, then run STEP 2.
--  (Postgres won't let a new enum value be *used* in the same transaction it's added.)
-- ============================================================================

-- ---------- STEP 1 — add the 'pending' role (run this alone first) ----------
alter type public.user_role add value if not exists 'pending';


-- ---------- STEP 2 — new users default to 'pending' (run after Step 1) -------
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
