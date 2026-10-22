-- ============================================================================
--  PTM HSS, Vettichira (PMSA) - staff register & basic pay
--
--  Source: the school's own "SALARY STATEMENT- SEPTEMBER- 2026" for PMSA PTM
--  HSS, VETTICHIRA - 67 staff plus the masjid's own two, Rs 749,819 of basic
--  pay and Rs 43,100 of monthly allowances. The unit, seeded as "Vettichira
--  School", is renamed to the name the school prints on its own statement.
--
--  Basic pay is loaded as each person's current basic, effective 2026-09-01,
--  so the salary history starts from that month and earlier months are
--  untouched. The duty allowances written into the basic column (SCOUT, JRC,
--  BULBUL, PRISM, BUNNIES, PEON - "9260+750") become salary components, as do
--  the karate allowance and the masjid cleaning paid to a driver already on
--  the sheet. Two people are paid by the day or by the duty with no monthly
--  basic, so theirs is left empty and said in the designation. The sheet's CL+
--  / CL- day adjustments are not stored here - those belong to a month's
--  payroll run, not to the register.
--
--  This sheet carries no staff ID numbers, so `code` is left empty.
--
--  Run after supabase/pmsa-units-payroll.sql. Safe to re-run: a staff member
--  already on this unit by name is matched, not duplicated.
--      node scripts/run-sql.mjs supabase/ptm-vettichira-staff-sept2026.sql
-- ============================================================================

-- The unit, under the name the school uses itself.
update public.units set name = 'PTM HSS, Vettichira'
 where institution = 'pmsa' and name = 'Vettichira School'
   and not exists (select 1 from public.units where institution = 'pmsa' and name = 'PTM HSS, Vettichira');

DO $ptm$
DECLARE
  v_unit uuid;
  v_from date := date '2026-09-01';
  r      record;
  v_id   uuid;
  v_new  integer := 0;
BEGIN
  SELECT id INTO v_unit FROM public.units WHERE institution = 'pmsa' AND name = 'PTM HSS, Vettichira';
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'The PTM HSS, Vettichira unit is missing - run supabase/pmsa-units-payroll.sql first';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
  (  1, 'BASHEER AHAMED', 'Principal', 33410.00, NULL, NULL),
  (  2, 'SATHAR C', 'Manager', 24120.00, NULL, NULL),
  (  3, 'BUSHARA KT', 'Office', 11440.00, NULL, NULL),
  (  4, 'LAMIYA', 'ITT&Office', 12080.00, NULL, NULL),
  (  5, 'NADIYA P', 'HSST', 19080.00, NULL, NULL),
  (  6, 'SHEEBA.PK', 'HSST', 15630.00, NULL, NULL),
  (  7, 'SHAREEFA', 'HSST', 13890.00, NULL, NULL),
  (  8, 'PRIYA R', 'HST', 14870.00, NULL, NULL),
  (  9, 'NIJA K', 'HST', 15900.00, NULL, NULL),
  ( 10, 'LATHIKA', 'HST', 12765.00, NULL, NULL),
  ( 11, 'FAISAL. E', 'HST', 12735.00, NULL, NULL),
  ( 12, 'SAHLATH KM', 'HST', 15000.00, NULL, NULL),
  ( 13, 'ABIDHA M', 'HST', 13350.00, NULL, NULL),
  ( 14, 'DIVYA E', 'HST', 11525.00, NULL, NULL),
  ( 15, 'FASILA FARSANA', 'HST', 11550.00, NULL, NULL),
  ( 16, 'HAFSATH KP', 'UPST/SCOUT', 11440.00, 1000.00, 'Scout allowance'),
  ( 17, 'VIJUSHA UNNI KP', 'UPST', 10940.00, NULL, NULL),
  ( 18, 'AYISHA SAJIDHA OK', 'LPST/JRC', 9910.00, 1000.00, 'JRC allowance'),
  ( 19, 'ROOFIYA AP', 'LPST/BULBUL', 10255.00, 750.00, 'Bulbul allowance'),
  ( 20, 'SHAMSEELA TV', 'LPST/BULBUL', 9260.00, 750.00, 'Bulbul allowance'),
  ( 21, 'CHITHRA VR', 'LPST', 10064.00, NULL, NULL),
  ( 22, 'SHANIFA THASNEEM', 'LPST/BULBUL', 9260.00, 750.00, 'Bulbul allowance'),
  ( 23, 'RAMLA PK', 'LPST', 10230.00, NULL, NULL),
  ( 24, 'SUMAYYA THASNI', 'LPST', 9750.00, NULL, NULL),
  ( 25, 'SHINI MV', 'LPST', 9750.00, NULL, NULL),
  ( 26, 'AJMALA FARVI', 'LPST', 7500.00, NULL, NULL),
  ( 27, 'NAJMA OK', 'KGT', 11395.00, NULL, NULL),
  ( 28, 'RAJNA TP', 'KGT', 10145.00, NULL, NULL),
  ( 29, 'SIBLA P', 'KGT/PRISM', 9150.00, 500.00, 'Prism allowance'),
  ( 30, 'FARSANA THESNI M', 'KGT/BUNNIES', 9150.00, 500.00, 'Bunnies allowance'),
  ( 31, 'SHAHANA.P', 'KGT/BUNNIES', 9320.00, 500.00, 'Bunnies allowance'),
  ( 32, 'FATHIMATH SHAKKIRA', 'KGT/BUNNIES', 8900.00, NULL, NULL),
  ( 33, 'VASILA OP', 'KGT', 8000.00, NULL, NULL),
  ( 34, 'UMMUSALMA', 'KGT', 8200.00, NULL, NULL),
  ( 35, 'SHAHMA SHERIN MP', 'KGT', 7500.00, NULL, NULL),
  ( 36, 'SULAIMAN DARIMI', 'SADAR MUALIM', 16530.00, NULL, NULL),
  ( 37, 'SHAHUL HAMEED', 'MUALIM/ARABIC', 17300.00, NULL, NULL),
  ( 38, 'HUSSAIN FAIZY', 'MUALIM', 9930.00, NULL, NULL),
  ( 39, 'ABDUL MAJEED', 'MUALIM', 9740.00, NULL, NULL),
  ( 40, 'SIDHEEQ ASLAMI', 'MUALIM', 9500.00, NULL, NULL),
  ( 41, 'MOHAMMED JASEEL', 'MUALIM', 10940.00, NULL, NULL),
  ( 42, 'SHAFNEEDKHAN', 'MUALIM', 9000.00, NULL, NULL),
  ( 43, 'MOHAMMED SALIH', 'MUALIM', 9000.00, NULL, NULL),
  ( 44, 'SAYYID MUHAMED RASHID', 'MUHALIM', 9000.00, NULL, NULL),
  ( 45, 'HIBATHULLAH', 'MUHALIM', 9000.00, NULL, NULL),
  ( 46, 'ARUN KUMAR', 'HST MATHS (Rs 925/day)', NULL, NULL, NULL),
  ( 47, 'JOSEPH RIO', 'CE', 11500.00, NULL, NULL),
  ( 48, 'ADHITHYAN VB', 'AI', 9600.00, NULL, NULL),
  ( 49, 'ABDUL KHADER', 'KARATTE', NULL, 31050.00, 'Karate allowance'),
  ( 50, 'PUSHPA K', 'AYA', 11570.00, NULL, NULL),
  ( 51, 'SAKKENA TK', 'AYA', 10915.00, NULL, NULL),
  ( 52, 'HABEEBA MK', 'AYA', 7300.00, NULL, NULL),
  ( 53, 'KADHEEJA CP', 'AYA', 6620.00, NULL, NULL),
  ( 54, 'DHEEPIKA', 'AYA', 6620.00, NULL, NULL),
  ( 55, 'SHALINI T', 'AYA', 6620.00, NULL, NULL),
  ( 56, 'SHIHAB THANGAL', 'DRIVER', 12000.00, NULL, NULL),
  ( 57, 'POCKER BAVA', 'DRIVER', 14930.00, NULL, NULL),
  ( 58, 'THOUFEEQUE', 'DRIVER', 12990.00, NULL, NULL),
  ( 59, 'MOHAMMED RAFI', 'DRIVER', 11920.00, NULL, NULL),
  ( 60, 'IBRAHIM KUTTY AK', 'DRIVER', 11250.00, NULL, NULL),
  ( 61, 'HASKER KP', 'DRIVER/PEON', 11025.00, 5000.00, 'Peon allowance'),
  ( 62, 'ASHRAF KP', 'DRIVER', 10250.00, NULL, NULL),
  ( 63, 'NABEEL', 'DRIVER', 10500.00, NULL, NULL),
  ( 64, 'IBRAHIM', 'CLEANER', 6450.00, NULL, NULL),
  ( 65, 'SIDHEEQUE', 'CLEANER', 6200.00, NULL, NULL),
  ( 66, 'SAHAL', 'CLEANER', 6000.00, NULL, NULL),
  ( 67, 'VALSAN PK', 'PET', 16000.00, NULL, NULL),
  ( 68, 'JASEEL WAFY', 'IMAM (Masjid)', 12155.00, NULL, NULL)
    ) AS t(sl, name, designation, basic, allowance, allowance_name)
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

    IF r.allowance IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.salary_components
       WHERE staff_id = v_id AND kind = 'allowance' AND name = r.allowance_name AND effective_from = v_from)
    THEN
      INSERT INTO public.salary_components (institution, staff_id, kind, name, amount, effective_from)
      VALUES ('pmsa', v_id, 'allowance', r.allowance_name, r.allowance, v_from);
    END IF;
  END LOOP;

  -- Paid to someone already on the sheet above, under the masjid's own staff.
  FOR r IN
    SELECT * FROM (VALUES
  ('POCKER BAVA', 'Masjid cleaning', 1300.00)
    ) AS t(name, allowance_name, amount)
  LOOP
    SELECT id INTO v_id FROM public.staff
     WHERE institution = 'pmsa' AND unit_id = v_unit AND upper(name) = upper(r.name)
     LIMIT 1;
    IF v_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.salary_components
       WHERE staff_id = v_id AND kind = 'allowance' AND name = r.allowance_name AND effective_from = v_from)
    THEN
      INSERT INTO public.salary_components (institution, staff_id, kind, name, amount, effective_from)
      VALUES ('pmsa', v_id, 'allowance', r.allowance_name, r.amount, v_from);
    END IF;
  END LOOP;

  RAISE NOTICE 'PTM HSS, Vettichira: % staff added', v_new;
END
$ptm$;

-- Check: headcount, basic pay and allowances now on the unit.
select u.name                       as unit,
       count(*)                     as staff,
       count(s.basic_salary)        as with_basic,
       sum(s.basic_salary)          as basic_total,
       (select coalesce(sum(amount), 0) from public.salary_components c
         where c.kind = 'allowance'
           and c.staff_id in (select id from public.staff where unit_id = u.id)) as allowance_total
  from public.staff s
  join public.units u on u.id = s.unit_id
 where u.institution = 'pmsa' and u.name = 'PTM HSS, Vettichira'
 group by u.id, u.name;
