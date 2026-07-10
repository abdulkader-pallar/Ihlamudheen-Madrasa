-- ============================================================================
--  Audit-trail hardening — run once in Supabase → SQL Editor.
--  Forces transactions.created_by to the signed-in user on INSERT, so an editor
--  cannot forge who created a record. (updated_by is already forced on UPDATE.)
--  Safe to re-run.
-- ============================================================================
create or replace function public.force_created_by()
returns trigger language plpgsql
as $$ begin new.created_by = auth.uid(); return new; end $$;

drop trigger if exists trg_force_created_by on public.transactions;
create trigger trg_force_created_by
  before insert on public.transactions
  for each row execute function public.force_created_by();
