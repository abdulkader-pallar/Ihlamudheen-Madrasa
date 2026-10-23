-- ============================================================================
--  PMSA Wafy College (PMSA) - staff register & basic pay
--
--  Source: the college's own September "SALARY STATEMENT" (30 days, 2 CL
--  alloted) and its companion "SALARY STATEMENT GUEST LECTURERS", both headed
--  ARABIC COLLEGE - 14 staff on monthly pay, Rs 3,30,812.33 of basic, and nine
--  guest-lecturer lines. The unit keeps the name it is seeded with, "PMSA Wafy
--  College"; the sheets' own header is ARABIC COLLEGE, which no one has asked
--  for yet.
--
--  Basic pay is loaded as each person's current basic, effective 2026-09-01,
--  so the salary history starts from that month and earlier months are
--  untouched. The sheet carries basic pay to four decimals (24879.1125,
--  21232.59375); money here is paise, so three of the fourteen round by half a
--  paisa and the basic total lands on 3,30,812.32 rather than .33125.
--
--  The guest sheet pays by the period or by the day, so those staff have no
--  monthly basic - the rate is said in the designation instead, as it is for
--  Vettichira's daily-rate teachers - except the two paid a flat monthly
--  figure with no rate or period count, the Communicative English and AI
--  teachers, whose figure is loaded as their basic. Both also teach at PTM
--  HSS, Vettichira and are on that unit's register too; each unit pays its own
--  people, and the AI teacher's figure differs between the two.
--
--  KABEER WAFY is on the guest sheet twice, at Rs 250.047 and Rs 220.2795 a
--  period, so he is one person here on two rates, not two people. The sheet
--  has no row 7 and no staff ID numbers, so `code` is left empty.
--
--  Everything else on the sheets belongs to a month's payroll run, not to the
--  register - the CL and LLP days, the leave allowance paid for the 2 CL
--  alloted (2 x basic/30), the special allowance paid to the Principal and the
--  Officer, and each guest's period or day count for the month. Those are in
--  supabase/wafy-college-payroll-sept2026.sql.
--
--  Run after supabase/pmsa-units-payroll.sql. Safe to re-run: a staff member
--  already on this unit by name is matched, not duplicated.
--      node scripts/run-sql.mjs supabase/wafy-college-staff-sept2026.sql
-- ============================================================================

DO $wafy$
DECLARE
  v_unit uuid;
  v_from date := date '2026-09-01';
  r      record;
  v_id   uuid;
  v_new  integer := 0;
BEGIN
  SELECT id INTO v_unit FROM public.units WHERE institution = 'pmsa' AND name = 'PMSA Wafy College';
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'The PMSA Wafy College unit is missing - run supabase/pmsa-units-payroll.sql first';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
  -- Monthly pay (the main statement).
  (  1, 'AHMED FAISY', 'Principal', 35172.15),
  (  2, 'ABDUL SALAM FAISY', 'Vice Principal', 35172.15),
  (  3, 'MUHAMMED FAISY', 'Lecturer', 25000.00),
  (  4, 'BASHEER WAFY', 'Lecturer', 24879.11),
  (  5, 'M SALEEM WAFY', 'Officer', 24879.11),
  (  6, 'SHIYAS ALI WAFY', 'Lecturer', 24879.11),
  (  7, 'AZHAR WAFY', 'Lecturer', 22448.10),
  (  8, 'SHUKOOR WAFY', 'Lecturer', 21232.59),
  (  9, 'SHAFI WAFY', 'Lecturer', 19800.00),
  ( 10, 'SAJID WAFY', 'Lecturer', 18750.00),
  ( 11, 'SHAFI AK', 'Lecturer', 12600.00),
  ( 12, 'BASHEER KAVALAPPARA', 'Lecturer', 30000.00),
  ( 13, 'BADSHA WAFY', 'Lecturer', 18000.00),
  ( 14, 'RIYAS WAFY', 'Mentor', 18000.00),
  -- Paid by the period or by the day (the guest-lecturer statement).
  ( 15, 'MUNEER WAFY', 'Guest Lecturer (Rs 238.14/period)', NULL),
  ( 16, 'NOORUDHEEN WAFY', 'Guest Lecturer (Rs 250.047/period)', NULL),
  ( 17, 'KABEER WAFY', 'Guest Lecturer (Rs 250.047 & 220.2795/period)', NULL),
  ( 18, 'SALEEM DELI', 'Guest Lecturer (Rs 220.2795/period)', NULL),
  ( 19, 'FAISAL SIR', 'Guest Lecturer (Rs 131.25/period)', NULL),
  ( 20, 'MAJEED WAFY', 'Hifz Teacher (Rs 566.66/day)', NULL),
  -- Paid a flat monthly figure on the guest sheet, with no rate or periods.
  ( 21, 'JOSEPH', 'Communicative English Teacher', 11500.00),
  ( 22, 'ADITHYAN', 'AI Teacher', 13200.00)
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

    IF r.basic IS NOT NULL THEN
      INSERT INTO public.salary_revisions (institution, staff_id, basic_salary, effective_from)
      VALUES ('pmsa', v_id, r.basic, v_from)
      ON CONFLICT (staff_id, effective_from) DO UPDATE SET basic_salary = excluded.basic_salary;
    END IF;
  END LOOP;

  RAISE NOTICE 'PMSA Wafy College: % staff added', v_new;
END
$wafy$;

-- Check: headcount and basic pay now on the unit. The 14 on monthly pay plus
-- the two guest teachers on a flat figure carry a basic; the six paid by the
-- period or the day do not.
select u.name                as unit,
       count(*)              as staff,
       count(s.basic_salary) as with_basic,
       sum(s.basic_salary)   as basic_total
  from public.staff s
  join public.units u on u.id = s.unit_id
 where u.institution = 'pmsa' and u.name = 'PMSA Wafy College'
 group by u.id, u.name;
