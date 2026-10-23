-- ============================================================================
--  Yatheem Khana (PMSA) - staff register & basic pay
--
--  Source: the orphanage's own "YATHEEMKHANA SALARY STATEMENT- SEP -2026"
--  (30 days, 2 CL alloted) and its companion "YATHEEMKHANA OVER TIME & EXTRA
--  DUTY STATEMENT- SEP -2026" - 21 staff and Rs 3,54,572.91 of basic pay, the
--  total printed at the foot of the salary statement.
--
--  Basic pay is loaded as each person's current basic, effective 2026-09-01,
--  so the salary history starts from that month and earlier months are
--  untouched. The sheets carry no staff ID numbers, so `code` is left empty.
--
--  MONKUTTY, a cleaner, is on the overtime sheet only, never on the salary
--  statement, so his basic comes from there (Rs 9,000) and the register has 22
--  people where the salary statement has 21. September pays him his extra duty
--  alone - see supabase/yatheem-khana-payroll-sept2026.sql.
--
--  Where the two sheets disagree, the salary statement is taken as the
--  register's word: BAHARUL ISLAM is a Helper there and a Supplier on the
--  overtime sheet, and JAMAL's basic is Rs 20,000 there against the Rs 2,000
--  the overtime sheet carries - which is in fact his September pay after 27
--  LLP days, not his basic, and the overtime sheet's own basic total of
--  3,03,502.88 is footed on that Rs 2,000.
--
--  Everything else on the sheets belongs to a month's payroll run, not to the
--  register: the leave allowance, the CL, LLP and absent-time deductions, the
--  overtime hours and extra duty days, and the special allowance - which here,
--  unlike Wafy College's, is one month's extra duty (the remarks name it: cook,
--  supplier, porotta duty, asst cook), not standing pay.
--
--  Run after supabase/pmsa-units-payroll.sql. Safe to re-run: a staff member
--  already on this unit by name is matched, not duplicated.
--      node scripts/run-sql.mjs supabase/yatheem-khana-staff-sept2026.sql
-- ============================================================================

DO $yk$
DECLARE
  v_unit uuid;
  v_from date := date '2026-09-01';
  r      record;
  v_id   uuid;
  v_new  integer := 0;
BEGIN
  SELECT id INTO v_unit FROM public.units WHERE institution = 'pmsa' AND name = 'Yatheem Khana';
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'The Yatheem Khana unit is missing - run supabase/pmsa-units-payroll.sql first';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
  (  1, 'KABEER WAFY', 'Officer', 23593.50),
  (  2, 'ASIF WAFY', 'Accountant', 22470.00),
  (  3, 'ANSWIF WAFY', 'Asst. Manager', 16066.05),
  (  4, 'SIRAJUDHEEN C', 'Moditor', 23000.00),
  (  5, 'ANEES PERUMAL', 'Civil Engineer', 19661.25),
  (  6, 'SHUKOOR WAFY', 'Imam & Qatheeb', 15750.00),
  (  7, 'SHOUKATHALI K', 'Muaddin', 12320.03),
  (  8, 'MOHAMMEDALI PK', 'Caretaker', 19293.75),
  (  9, 'HASHIL WAFY', 'Mentor', 10500.00),
  ( 10, 'NAFEESATH LAILA', 'Care Taker', 6380.83),
  ( 11, 'MUNEERA WAFIYYA', 'CWO', 16537.50),
  ( 12, 'NASHVA P P', 'Campus Counselor', 15000.00),
  ( 13, 'SUBAIDA', 'Mentor', 12000.00),
  ( 14, 'KUNJIKOYA', 'Office Attender', 15000.00),
  ( 15, 'SHAREEF', 'Main Cook', 30000.00),
  ( 16, 'JAMAL', 'Asst. Cook', 20000.00),
  ( 17, 'BAHARUL ISLAM', 'Helper', 18000.00),
  ( 18, 'MAJAHARUL ISLAM', 'Supplier', 15000.00),
  ( 19, 'ABUBAKKAR SIDDIQUE', 'Supplier', 15000.00),
  ( 20, 'INDADUL ISLAM', 'Supplier', 15000.00),
  ( 21, 'HASHIM KOYA', 'Security', 14000.00),
  -- On the overtime sheet only.
  ( 22, 'MONKUTTY', 'Cleaner', 9000.00)
    ) AS t(sl, name, designation, basic)
    ORDER BY sl
  LOOP
    SELECT id INTO v_id FROM public.staff
     WHERE institution = 'pmsa' AND unit_id = v_unit AND upper(name) = upper(r.name)
     LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO public.staff (institution, unit_id, name, designation, basic_salary, active)
      VALUES ('pmsa', v_unit, r.name, r.designation, r.basic, true)
      RETURNING id INTO v_id;
      v_new := v_new + 1;
    END IF;

    INSERT INTO public.salary_revisions (institution, staff_id, basic_salary, effective_from)
    VALUES ('pmsa', v_id, r.basic, v_from)
    ON CONFLICT (staff_id, effective_from) DO UPDATE SET basic_salary = excluded.basic_salary;
  END LOOP;

  RAISE NOTICE 'Yatheem Khana: % staff added', v_new;
END
$yk$;

-- Check: headcount and basic pay now on the unit. The salary statement's
-- 3,54,572.91 plus the cleaner the overtime sheet adds.
select u.name              as unit,
       count(*)            as staff,
       sum(s.basic_salary) as basic_total
  from public.staff s
  join public.units u on u.id = s.unit_id
 where u.institution = 'pmsa' and u.name = 'Yatheem Khana'
 group by u.id, u.name;
