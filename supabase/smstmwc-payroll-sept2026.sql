-- ============================================================================
--  SMSTMWC (PMSA) - September 2026 payroll run
--
--  Source: the same "SALARY STATEMENT 2026" the register was loaded from (see
--  supabase/smstmwc-staff-sept2026.sql), September, 30 days. The register
--  holds only standing pay, so the month's own figures are put here, in the
--  two columns the Payroll page keeps for them:
--
--    bonus           = the LEAVE ALLOWANCE column, 1.5 days' pay (basic/30)
--                      for the casual leave allotted that month
--    other_deduction = the CL and LLP days deducted
--
--  Each line is paid for all 30 days, as the sheet does: full basic, then the
--  leave days taken deducted from it, rather than fewer days worked.
--
--        staff          basic   +allowance   -CL/LLP        net
--        Jamsheer VK    17363      868.15    6077.05    12154.10
--        Moideen PK     10778      538.90     179.63    11137.27
--        Dakshayani TT   7840      392.00     130.67     8101.33
--        total          35981     1799.05    6387.35    31392.70
--
--  The 31,392.70 is the FINAL total printed at the foot of the sheet.
--
--  The run is left a DRAFT. Approving it, and marking it paid - which posts
--  the one "Staff Salaries" expense against the unit - is done in the portal,
--  not here. A run already approved or paid is never touched: re-running then
--  fails rather than rewriting a closed month.
--
--  Run after supabase/smstmwc-staff-sept2026.sql. Safe to re-run while the run
--  is a draft: its lines are rebuilt, as the page's own Rebuild does.
--      node scripts/run-sql.mjs supabase/smstmwc-payroll-sept2026.sql
-- ============================================================================

DO $smstmwcpay$
DECLARE
  v_unit   uuid;
  v_run    uuid;
  v_status text;
  v_month  date := date '2026-09-01';
  v_days   integer := 30;
  r        record;
  v_id     uuid;
  v_gross  numeric(12,2);
BEGIN
  SELECT id INTO v_unit FROM public.units WHERE institution = 'pmsa' AND name = 'SMSTMWC';
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'The SMSTMWC unit is missing - run supabase/smstmwc-staff-sept2026.sql first';
  END IF;

  SELECT id, status INTO v_run, v_status
    FROM public.payroll_runs WHERE unit_id = v_unit AND month = v_month;

  IF v_run IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'September 2026 is already % for SMSTMWC - reopen it in the portal before loading it again', v_status;
  END IF;

  IF v_run IS NULL THEN
    INSERT INTO public.payroll_runs (institution, unit_id, month, status)
    VALUES ('pmsa', v_unit, v_month, 'draft')
    RETURNING id INTO v_run;
  ELSE
    DELETE FROM public.payroll_lines WHERE run_id = v_run;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
  (  1, 'JAMSHEER VK',   868.15, 6077.05, 'CL 1.5 days (868.15) + LLP 9 days (5,208.90) deducted; 1.5 days'' leave allowance paid'),
  (  2, 'MOIDEEN PK',    538.90,  179.63, 'CL 0.5 day (179.63) deducted; 1.5 days'' leave allowance paid'),
  (  3, 'DAKSHAYANI TT', 392.00,  130.67, 'CL 0.5 day (130.67) deducted; 1.5 days'' leave allowance paid')
    ) AS t(sl, name, leave_allowance, leave_deduction, note)
    ORDER BY sl
  LOOP
    SELECT id INTO v_id FROM public.staff
     WHERE institution = 'pmsa' AND unit_id = v_unit AND upper(name) = upper(r.name)
     LIMIT 1;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '% is not on the SMSTMWC register - run supabase/smstmwc-staff-sept2026.sql first', r.name;
    END IF;

    INSERT INTO public.payroll_lines (
      institution, run_id, staff_id, staff_name, designation,
      days_in_month, days_worked, basic, allowances, deductions, employer,
      bonus, other_deduction, gross, net, cost, note)
    SELECT 'pmsa', v_run, s.id, s.name, s.designation,
           v_days, v_days, s.basic_salary, 0, 0, 0,
           r.leave_allowance, r.leave_deduction,
           s.basic_salary + r.leave_allowance,
           s.basic_salary + r.leave_allowance - r.leave_deduction,
           s.basic_salary + r.leave_allowance,
           r.note
      FROM public.staff s WHERE s.id = v_id;
  END LOOP;

  SELECT sum(net) INTO v_gross FROM public.payroll_lines WHERE run_id = v_run;
  IF v_gross <> 31392.70 THEN
    RAISE EXCEPTION 'Net pay came to %, not the 31,392.70 printed on the sheet', v_gross;
  END IF;

  RAISE NOTICE 'SMSTMWC September 2026: draft run with 3 lines, net 31,392.70';
END
$smstmwcpay$;

-- Check: the run and what it pays.
select r.status,
       count(l.*)        as staff,
       sum(l.basic)      as basic,
       sum(l.bonus)      as leave_allowance,
       sum(l.other_deduction) as leave_deduction,
       sum(l.gross)      as gross,
       sum(l.net)        as net,
       sum(l.cost)       as cost
  from public.payroll_runs r
  join public.units u on u.id = r.unit_id
  left join public.payroll_lines l on l.run_id = r.id
 where u.institution = 'pmsa' and u.name = 'SMSTMWC' and r.month = date '2026-09-01'
 group by r.id, r.status;
