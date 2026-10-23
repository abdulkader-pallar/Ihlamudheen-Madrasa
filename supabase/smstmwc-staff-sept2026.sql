-- ============================================================================
--  SMSTMWC (PMSA) - staff register & basic pay
--
--  Source: the college's own "SALARY STATEMENT 2026" for SMSTMWC, September,
--  30 days - three staff and Rs 35,981 of basic pay, which is the total
--  printed at the foot of the sheet. The unit, seeded as "Women's College", is
--  renamed to the name the college prints on its own statement.
--
--  Basic pay is loaded as each person's current basic, effective 2026-09-01,
--  so the salary history starts from that month and earlier months are
--  untouched. The sheet carries no staff ID numbers, so `code` is left empty.
--
--  Everything else on the sheet belongs to a month's payroll run, not to the
--  register: the 1.5 days of casual leave allotted, the LEAVE ALLOWANCE paid
--  for them (1.5 x basic/30 for each of the three, so it follows the basic
--  rather than being a figure of its own), the CL and LLP days deducted, and
--  the absent-time column. September's own figures, for whoever runs that
--  month: CL/LLP deductions Rs 6,387.35, leave allowance Rs 1,799.05, net
--  Rs 31,392.70.
--
--  Run after supabase/pmsa-units-payroll.sql. Safe to re-run: a staff member
--  already on this unit by name is matched, not duplicated.
--      node scripts/run-sql.mjs supabase/smstmwc-staff-sept2026.sql
-- ============================================================================

-- The unit, under the name the college uses itself.
update public.units set name = 'SMSTMWC'
 where institution = 'pmsa' and name = 'Women''s College'
   and not exists (select 1 from public.units where institution = 'pmsa' and name = 'SMSTMWC');

DO $smstmwc$
DECLARE
  v_unit uuid;
  v_from date := date '2026-09-01';
  r      record;
  v_id   uuid;
  v_new  integer := 0;
BEGIN
  SELECT id INTO v_unit FROM public.units WHERE institution = 'pmsa' AND name = 'SMSTMWC';
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'The SMSTMWC unit is missing - run supabase/pmsa-units-payroll.sql first';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
  (  1, 'JAMSHEER VK', 'Officer', 17363.00),
  (  2, 'MOIDEEN PK', 'Security', 10778.00),
  (  3, 'DAKSHAYANI TT', 'Sweeper', 7840.00)
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

  RAISE NOTICE 'SMSTMWC: % staff added', v_new;
END
$smstmwc$;

-- Check: headcount and basic pay now on the unit.
select u.name                as unit,
       count(*)              as staff,
       sum(s.basic_salary)   as basic_total
  from public.staff s
  join public.units u on u.id = s.unit_id
 where u.institution = 'pmsa' and u.name = 'SMSTMWC'
 group by u.id, u.name;
