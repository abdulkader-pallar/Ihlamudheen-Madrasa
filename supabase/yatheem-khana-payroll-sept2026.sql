-- ============================================================================
--  Yatheem Khana (PMSA) - September 2026 payroll run
--
--  Source: the two September sheets the register was loaded from (see
--  supabase/yatheem-khana-staff-sept2026.sql), 30 days, 2 CL alloted. The
--  register holds only standing pay, so the month's own figures are put here,
--  in the two columns the Payroll page keeps for them:
--
--    bonus           = the LEAVE ALLOWANCE column, plus everything the
--                      overtime sheet pays - overtime hours, extra duty days
--                      and the special allowance paid for an extra duty
--    other_deduction = the CL days, the LLP days and the absent time
--
--  The leave allowance is the cash value of the 2 CL alloted, so a line that
--  takes its casual leave is paid the allowance and has the days deducted
--  again, and only leave NOT taken is money kept: Muneera Wafiyya, who took
--  all 2 days, nets nothing from it, while Answif Wafy, who took 1, keeps one
--  day's worth. Nine of the 21 are granted no leave allowance at all, as the
--  sheet shows with a 0 in the column.
--
--  The portal keeps one run per unit per month, so both sheets are in it:
--
--    salary statement       basic 3,54,572.91 + 11,874.80 - 26,753.14 = 3,39,694.57
--    overtime & extra duty                                                 22,253.88
--    the run's net pay                                                   3,61,948.45
--
--  Both figures are the totals printed at the feet of the two sheets, and
--  every line but one matches its own FINAL as well. The exception is Muneera
--  Wafiyya, whose LLP of half a day at Rs 551.25 is Rs 275.625: her line is
--  paid 16,261.87 against the 16,261.88 printed, because money here is whole
--  paise, and the 3,39,694.57 at the foot of her own sheet is footed the same
--  way. The sheet's absent-time total is a paisa adrift of its column for the
--  same reason (1,049.80 printed against 1,049.79).
--
--  MONKUTTY is on the overtime sheet only, so his line is worked 0 of 30 days
--  - no monthly salary this month - and pays his extra duty alone.
--
--  The run is left a DRAFT. Approving it, and marking it paid - which posts
--  the one "Staff Salaries" expense against the unit - is done in the portal,
--  not here. A run already approved or paid is never touched: re-running then
--  fails rather than rewriting a closed month.
--
--  The salary statement's PAID and BALANCE columns, which show Abubakkar
--  Siddique and Hashim Koya part-paid already, have no place on a run - the
--  page pays a month in one posting - so they are said in those two lines'
--  notes instead.
--
--  Run after supabase/yatheem-khana-staff-sept2026.sql. Safe to re-run while
--  the run is a draft: its lines are rebuilt, as the page's own Rebuild does.
--      node scripts/run-sql.mjs supabase/yatheem-khana-payroll-sept2026.sql
-- ============================================================================

DO $ykpay$
DECLARE
  v_unit   uuid;
  v_run    uuid;
  v_status text;
  v_month  date := date '2026-09-01';
  v_days   integer := 30;
  r        record;
  v_id     uuid;
  v_allow  numeric(12,2);
  v_net    numeric(12,2);
  v_total  numeric(12,2) := 0;
  v_ded    numeric(12,2);
  v_bonus  numeric(12,2);
BEGIN
  SELECT id INTO v_unit FROM public.units WHERE institution = 'pmsa' AND name = 'Yatheem Khana';
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'The Yatheem Khana unit is missing - run supabase/yatheem-khana-staff-sept2026.sql first';
  END IF;

  SELECT id, status INTO v_run, v_status
    FROM public.payroll_runs WHERE unit_id = v_unit AND month = v_month;

  IF v_run IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'September 2026 is already % for Yatheem Khana - reopen it in the portal before loading it again', v_status;
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
  (  1, 'KABEER WAFY',        30, 1572.90,       0, '2 days'' leave allowance paid'),
  (  2, 'ASIF WAFY',          30, 1647.80,   29.96, '0.4 hour absent (29.96) deducted; 2 days'' leave allowance paid; 2 hours overtime 149.80'),
  (  3, 'ANSWIF WAFY',        30, 1953.13,  724.55, 'CL 1 day (535.54) + 3 hours absent (189.01) deducted; 2 days'' leave allowance paid; 14 hours overtime 882.06'),
  (  4, 'SIRAJUDHEEN C',      30, 1533.33,       0, '2 days'' leave allowance paid'),
  (  5, 'ANEES PERUMAL',      30, 1899.77,  184.32, '2.25 hours absent (184.32) deducted; 2 days'' leave allowance paid; 7.19 hours overtime 589.02'),
  (  6, 'SHUKOOR WAFY',       30,       0,       0, 'No leave allowance granted'),
  (  7, 'SHOUKATHALI K',      30,       0,       0, 'No leave allowance granted'),
  (  8, 'MOHAMMEDALI PK',     30, 2619.25,  495.74, '18.5 hours absent (495.74) deducted; 2 days'' leave allowance paid; extra duty of cook 1,333.00'),
  (  9, 'HASHIL WAFY',        30,  700.00,       0, '2 days'' leave allowance paid'),
  ( 10, 'NAFEESATH LAILA',    30,       0,  143.57, 'LLP 0.5 day (106.35) + 4.2 hours absent (37.22) deducted; no leave allowance granted'),
  ( 11, 'MUNEERA WAFIYYA',    30, 1102.50, 1378.13, 'CL 2 days (1,102.50) + LLP 0.5 day (275.63) deducted; 2 days'' leave allowance paid, all of it taken back'),
  ( 12, 'NASHVA P P',         30, 1000.00,       0, '2 days'' leave allowance paid'),
  ( 13, 'SUBAIDA',            30,  800.00,       0, '2 days'' leave allowance paid'),
  ( 14, 'KUNJIKOYA',          30,       0, 2863.54, 'LLP 5.5 days (2,750.00) + 5.45 hours absent (113.54) deducted; no leave allowance granted'),
  ( 15, 'SHAREEF',            30,       0, 2000.00, 'LLP 2 days (2,000.00) deducted; no leave allowance granted'),
  ( 16, 'JAMAL',              30,  200.00, 18000.00, 'LLP 27 days (18,000.00) deducted; 3 days extra duty 200.00; no leave allowance granted'),
  ( 17, 'BAHARUL ISLAM',      30, 2400.00,       0, '4 days extra duty 2,400.00; no leave allowance granted'),
  ( 18, 'MAJAHARUL ISLAM',    30, 5700.00,       0, '4 days extra duty 2,000.00 + extra duty of supplier & porotta duty 3,700.00; no leave allowance granted'),
  ( 19, 'ABUBAKKAR SIDDIQUE', 30, 5500.00,       0, '4 days extra duty 2,000.00 + extra duty of supplier 3,500.00; no leave allowance granted. Rs 2,000 of the salary statement''s 15,000 already paid'),
  ( 20, 'INDADUL ISLAM',      30, 4000.00,       0, '4 days extra duty 2,000.00 + extra duty of asst cook 2,000.00; no leave allowance granted'),
  ( 21, 'HASHIM KOYA',        30,       0,  933.33, 'LLP 2 days (933.33) deducted; no leave allowance granted. Rs 13,066 of the salary statement''s 13,066.67 already paid'),
  ( 22, 'MONKUTTY',            0, 1500.00,       0, 'Not on the September salary statement: 5 days extra duty of attender, 1,500.00, and no monthly salary')
    ) AS t(sl, name, days, addition, deduction, note)
    ORDER BY sl
  LOOP
    SELECT id INTO v_id FROM public.staff
     WHERE institution = 'pmsa' AND unit_id = v_unit AND upper(name) = upper(r.name)
     LIMIT 1;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '% is not on the Yatheem Khana register - run supabase/yatheem-khana-staff-sept2026.sql first', r.name;
    END IF;

    -- Standing allowances in force this month, as lib/unit-payroll.ts reads them.
    SELECT coalesce(sum(amount), 0) INTO v_allow
      FROM public.salary_components
     WHERE staff_id = v_id AND kind = 'allowance'
       AND effective_from <= (v_month + interval '1 month - 1 day')::date
       AND (effective_to IS NULL OR effective_to >= v_month);

    -- Basic and standing allowances are pro-rated by the days worked, the
    -- bonus and the other deduction are the month's own; see computeLine().
    INSERT INTO public.payroll_lines (
      institution, run_id, staff_id, staff_name, designation,
      days_in_month, days_worked, basic, allowances, deductions, employer,
      bonus, other_deduction, gross, net, cost, note)
    SELECT 'pmsa', v_run, s.id, s.name, s.designation,
           v_days, r.days, coalesce(s.basic_salary, 0), v_allow, 0, 0,
           r.addition, r.deduction,
           round((coalesce(s.basic_salary, 0) + v_allow) * r.days / v_days, 2) + r.addition,
           round((coalesce(s.basic_salary, 0) + v_allow) * r.days / v_days, 2) + r.addition - r.deduction,
           round((coalesce(s.basic_salary, 0) + v_allow) * r.days / v_days, 2) + r.addition,
           r.note
      FROM public.staff s WHERE s.id = v_id
    RETURNING net INTO v_net;

    v_total := v_total + v_net;
  END LOOP;

  SELECT sum(other_deduction), sum(bonus) INTO v_ded, v_bonus
    FROM public.payroll_lines WHERE run_id = v_run;

  IF v_total <> 361948.45 THEN
    RAISE EXCEPTION 'Net pay came to %, not the 3,39,694.57 and 22,253.88 the two sheets print (3,61,948.45)', v_total;
  END IF;
  IF v_ded <> 26753.14 THEN
    RAISE EXCEPTION 'Deductions came to %, not the 26,753.14 printed on the salary statement', v_ded;
  END IF;
  IF v_bonus <> 34128.68 THEN
    RAISE EXCEPTION 'Additions came to %, not the 11,874.80 + 22,253.88 the two sheets print', v_bonus;
  END IF;

  RAISE NOTICE 'Yatheem Khana September 2026: draft run with 22 lines, net 3,61,948.45';
END
$ykpay$;

-- Check: the run and what it pays.
select r.status,
       count(l.*)             as staff,
       sum(l.basic)           as basic,
       sum(l.bonus)           as additions,
       sum(l.other_deduction) as deductions,
       sum(l.gross)           as gross,
       sum(l.net)             as net
  from public.payroll_runs r
  join public.units u on u.id = r.unit_id
  left join public.payroll_lines l on l.run_id = r.id
 where u.institution = 'pmsa' and u.name = 'Yatheem Khana' and r.month = date '2026-09-01'
 group by r.id, r.status;
