-- ============================================================================
--  PMSA Wafy College (PMSA) - September 2026 payroll run
--
--  Source: the two September sheets the register was loaded from (see
--  supabase/wafy-college-staff-sept2026.sql), 30 days, 2 CL alloted. The
--  register holds only standing pay, so the month's own figures are put here,
--  in the two columns the Payroll page keeps for them:
--
--    bonus           = the LEAVE ALLOWANCE column (2 days' pay, basic/30 x 2)
--                      and, for the guest sheet, the month's periods or days
--    other_deduction = the CL and LLP days deducted
--
--  The SP. ALLOWANCE is standing pay, so it is not written here: each line
--  reads it from the register's salary components, as the page's own Rebuild
--  does, and it lands in the allowances column rather than the bonus.
--
--  Each monthly line is paid for all 30 days, as the sheet does: full basic,
--  then the leave days taken deducted from it, rather than fewer days worked.
--
--  The portal keeps one run per unit per month, so both sheets are in it. They
--  still add up to their own printed totals:
--
--    main statement   basic 3,30,812.32 + 31,046.50 - 10,425.52 = 3,51,433.30
--    guest lecturers                                               56,628.16
--    the run's net pay                                           4,08,061.46
--
--  The sheets print 3,51,433 and 56,628, each the sum of its unrounded figures
--  cut to whole rupees. The 31,046.50 is TOTAL ADTN - leave allowance 22,054.17
--  as the bonus, plus the two special allowances, 8,992.33, from the register -
--  and the 10,425.52 is TOTAL DED.
--
--  The run is left a DRAFT. Approving it, and marking it paid - which posts
--  the one "Staff Salaries" expense against the unit - is done in the portal,
--  not here. A run already approved or paid is never touched: re-running then
--  fails rather than rewriting a closed month.
--
--  Run after supabase/wafy-college-staff-sept2026.sql. Safe to re-run while
--  the run is a draft: its lines are rebuilt, as the page's own Rebuild does.
--      node scripts/run-sql.mjs supabase/wafy-college-payroll-sept2026.sql
-- ============================================================================

DO $wafypay$
DECLARE
  v_unit   uuid;
  v_run    uuid;
  v_status text;
  v_month  date := date '2026-09-01';
  v_days   integer := 30;
  r        record;
  v_id     uuid;
  v_main   numeric(12,2) := 0;
  v_guest  numeric(12,2) := 0;
  v_net    numeric(12,2);
  v_allow  numeric(12,2);
BEGIN
  SELECT id INTO v_unit FROM public.units WHERE institution = 'pmsa' AND name = 'PMSA Wafy College';
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'The PMSA Wafy College unit is missing - run supabase/wafy-college-staff-sept2026.sql first';
  END IF;

  SELECT id, status INTO v_run, v_status
    FROM public.payroll_runs WHERE unit_id = v_unit AND month = v_month;

  IF v_run IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'September 2026 is already % for PMSA Wafy College - reopen it in the portal before loading it again', v_status;
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
  -- Monthly pay: leave allowance (+ special allowance), CL and LLP deducted.
  (  1, 'main',  'AHMED FAISY',          2344.81,       0, '2 days'' leave allowance paid; special allowance from the register'),
  (  2, 'main',  'ABDUL SALAM FAISY',    2344.81, 1172.41, 'CL 1 day (1,172.41) deducted; 2 days'' leave allowance paid'),
  (  3, 'main',  'MUHAMMED FAISY',       1666.67,  833.33, 'CL 1 day (833.33) deducted; 2 days'' leave allowance paid'),
  (  4, 'main',  'BASHEER WAFY',         1658.61,  829.30, 'CL 1 day (829.30) deducted; 2 days'' leave allowance paid'),
  (  5, 'main',  'M SALEEM WAFY',        1658.61,       0, '2 days'' leave allowance paid; special allowance from the register'),
  (  6, 'main',  'SHIYAS ALI WAFY',      1658.61, 5390.48, 'CL 2 days (1,658.61) + LLP 4.5 days (3,731.87) deducted; 2 days'' leave allowance paid'),
  (  7, 'main',  'AZHAR WAFY',           1496.54,       0, '2 days'' leave allowance paid'),
  (  8, 'main',  'SHUKOOR WAFY',         1415.51,       0, '2 days'' leave allowance paid'),
  (  9, 'main',  'SHAFI WAFY',           1320.00,       0, '2 days'' leave allowance paid'),
  ( 10, 'main',  'SAJID WAFY',           1250.00,       0, '2 days'' leave allowance paid'),
  ( 11, 'main',  'SHAFI AK',              840.00,       0, '2 days'' leave allowance paid'),
  ( 12, 'main',  'BASHEER KAVALAPPARA',  2000.00, 1000.00, 'CL 1 day (1,000.00) deducted; 2 days'' leave allowance paid'),
  ( 13, 'main',  'BADSHA WAFY',          1200.00,  600.00, 'CL 1 day (600.00) deducted; 2 days'' leave allowance paid'),
  ( 14, 'main',  'RIYAS WAFY',           1200.00,  600.00, 'CL 1 day (600.00) deducted; 2 days'' leave allowance paid'),
  -- The guest sheet: the month's periods or days, with no monthly basic
  -- behind them except the two paid a flat figure.
  ( 15, 'guest', 'MUNEER WAFY',           714.42,       0, 'Guest lecturer: 3 periods at 238.14'),
  ( 16, 'guest', 'NOORUDHEEN WAFY',      3000.56,       0, 'Guest lecturer: 12 periods at 250.047'),
  ( 17, 'guest', 'KABEER WAFY',          6114.24,       0, 'Guest lecturer: 13 periods at 250.047 (3,250.61) + 13 at 220.2795 (2,863.63)'),
  ( 18, 'guest', 'SALEEM DELI',          7048.94,       0, 'Guest lecturer: 32 periods at 220.2795'),
  ( 19, 'guest', 'FAISAL SIR',           3150.00,       0, 'Guest lecturer: 24 periods at 131.25'),
  ( 20, 'guest', 'MAJEED WAFY',         11900.00,       0, 'Hifz teacher: 21 days at 566.66'),
  ( 21, 'guest', 'JOSEPH',                    0,        0, 'Guest sheet: flat monthly figure, no rate or periods'),
  ( 22, 'guest', 'ADITHYAN',                  0,        0, 'Guest sheet: flat monthly figure, no rate or periods')
    ) AS t(sl, sheet, name, addition, deduction, note)
    ORDER BY sl
  LOOP
    SELECT id INTO v_id FROM public.staff
     WHERE institution = 'pmsa' AND unit_id = v_unit AND upper(name) = upper(r.name)
     LIMIT 1;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '% is not on the PMSA Wafy College register - run supabase/wafy-college-staff-sept2026.sql first', r.name;
    END IF;

    -- Standing allowances in force this month, as lib/unit-payroll.ts reads them.
    SELECT coalesce(sum(amount), 0) INTO v_allow
      FROM public.salary_components
     WHERE staff_id = v_id AND kind = 'allowance'
       AND effective_from <= (v_month + interval '1 month - 1 day')::date
       AND (effective_to IS NULL OR effective_to >= v_month);

    INSERT INTO public.payroll_lines (
      institution, run_id, staff_id, staff_name, designation,
      days_in_month, days_worked, basic, allowances, deductions, employer,
      bonus, other_deduction, gross, net, cost, note)
    SELECT 'pmsa', v_run, s.id, s.name, s.designation,
           v_days, v_days, coalesce(s.basic_salary, 0), v_allow, 0, 0,
           r.addition, r.deduction,
           coalesce(s.basic_salary, 0) + v_allow + r.addition,
           coalesce(s.basic_salary, 0) + v_allow + r.addition - r.deduction,
           coalesce(s.basic_salary, 0) + v_allow + r.addition,
           r.note
      FROM public.staff s WHERE s.id = v_id
    RETURNING net INTO v_net;

    -- Each sheet is totalled as its own lines go in.
    IF r.sheet = 'main' THEN v_main := v_main + v_net; ELSE v_guest := v_guest + v_net; END IF;
  END LOOP;

  IF v_main <> 351433.30 THEN
    RAISE EXCEPTION 'The monthly staff come to %, not the 3,51,433 printed on the sheet', v_main;
  END IF;
  IF v_guest <> 56628.16 THEN
    RAISE EXCEPTION 'The guest lecturers come to %, not the 56,628 printed on the sheet', v_guest;
  END IF;

  RAISE NOTICE 'PMSA Wafy College September 2026: draft run with 22 lines, net 4,08,061.46';
END
$wafypay$;

-- Check: the run and what it pays.
select r.status,
       count(l.*)             as staff,
       sum(l.basic)           as basic,
       sum(l.allowances)      as allowances,
       sum(l.bonus)           as additions,
       sum(l.other_deduction) as deductions,
       sum(l.gross)           as gross,
       sum(l.net)             as net
  from public.payroll_runs r
  join public.units u on u.id = r.unit_id
  left join public.payroll_lines l on l.run_id = r.id
 where u.institution = 'pmsa' and u.name = 'PMSA Wafy College' and r.month = date '2026-09-01'
 group by r.id, r.status;
