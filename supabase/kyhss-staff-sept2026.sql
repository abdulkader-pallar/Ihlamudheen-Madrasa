-- ============================================================================
--  KYHSS Athavanad (PMSA) - staff register, staff IDs & basic pay
--
--  Source: the school's own salary statement "SALARY STATEMENT 2025-26
--  (SEPTEMBER -2026)" for KYHSS ATHAVANAD - 110 staff, basic pay total
--  Rs 13,70,790. The unit, seeded as "KYYHSS School", is renamed to the name
--  the school prints on that statement. Basic pay is loaded as each person's current basic, effective
--  2026-09-01, so the salary history (salary_revisions) starts from that month
--  and earlier months are untouched. The statement's fixed monthly allowance
--  column is loaded as an "Allowance" salary component for the seven staff who
--  have one; its CL+ / CL- day adjustments are not stored here - those belong
--  to a month's payroll run, not to the register.
--
--  `code` is the staff ID printed on the statement (three of the 110 have none
--  there, so theirs stays empty).
--
--  Run after supabase/pmsa-units-payroll.sql and supabase/staff-code.sql.
--  Safe to re-run: a staff member already on this unit by name is matched, not
--  duplicated, and only their staff ID is filled in.
--      node scripts/run-sql.mjs supabase/kyhss-staff-sept2026.sql
-- ============================================================================

-- The unit, under the name the school uses itself.
update public.units set name = 'KYHSS Athavanad'
 where institution = 'pmsa' and name = 'KYYHSS School'
   and not exists (select 1 from public.units where institution = 'pmsa' and name = 'KYHSS Athavanad');

DO $kyhss$
DECLARE
  v_unit uuid;
  v_from date := date '2026-09-01';
  r      record;
  v_id   uuid;
  v_new  integer := 0;
BEGIN
  SELECT id INTO v_unit FROM public.units WHERE institution = 'pmsa' AND name = 'KYHSS Athavanad';
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'The KYHSS Athavanad unit is missing - run supabase/pmsa-units-payroll.sql first';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
  (  1,   '86', 'MUNEER KAPPAN', 'Principal', 46000.00, 0.00),
  (  2,   '47', 'NOORUDHEEN KP', 'Vice Principal', 30475.00, 0.00),
  (  3,  '212', 'MOHAMED YUNUS PC', 'Office Assi', 13960.00, 0.00),
  (  4,   '98', 'MUHAMMED IQBAL C', 'AI Lab Tech', 21000.00, 0.00),
  (  5,  '257', 'SAWAD K', 'Accountant', 11000.00, 0.00),
  (  6,  '244', 'NALIMUDHEEN A', 'PRO', 16500.00, 0.00),
  (  7,    '5', 'RAJI M', 'HSS', 17614.00, 0.00),
  (  8,   '13', 'NAFEESATHU LAILA K', 'HSS', 16464.00, 0.00),
  (  9,   '69', 'JAYALAKSHMI K', 'HSS', 15317.00, 0.00),
  ( 10,  '264', 'MUHAMED RAFIL P', 'HSS', 16500.00, 0.00),
  ( 11,  '251', 'MOHAMED SHAFI AK', 'HSS', 6300.00, 0.00),
  ( 12,  '238', 'FAIZAL F', 'HSS', 18900.00, 0.00),
  ( 13,  '232', 'SARIF K', 'HSS', 18900.00, 0.00),
  ( 14,  '131', 'YASIR PK', 'HS', 24096.00, 0.00),
  ( 15,  '133', 'MUNEER CC', 'HS', 22575.00, 0.00),
  ( 16,   '21', 'SUNEERA K', 'HS', 13371.00, 0.00),
  ( 17,  '237', 'SHINJU NP', 'HS', 13000.00, 0.00),
  ( 18,  '234', 'MASHOOD VP', 'HS', 19950.00, 0.00),
  ( 19,  '220', 'SABANU YASMIN C', 'HS', 13125.00, 0.00),
  ( 20,  '228', 'NAHLA V', 'HS', 13650.00, 0.00),
  ( 21,  '221', 'FASIL P', 'HS', 19950.00, 0.00),
  ( 22,  '268', 'FATHIMA ANNATH KV', 'HS', 13000.00, 0.00),
  ( 23,  '136', 'HAFSATH P', 'IT', 8509.00, 0.00),
  ( 24,  '233', 'RISNA MOL VP', 'IT', 9975.00, 0.00),
  ( 25,  '239', 'ASHIKH', 'PET', 21000.00, 0.00),
  ( 26,  '109', 'SANJAY MALLAY', 'CE', 26250.00, 0.00),
  ( 27,  '110', 'SUJATA BAISHYA', 'CE', 26250.00, 0.00),
  ( 28,  '281', 'KAMLEI', 'CE', 23000.00, 0.00),
  ( 29,  '263', 'MRUDULA KP', 'HOD LP & UP', 25000.00, 0.00),
  ( 30,    '8', 'SULAIKA V', 'UPS', 11760.00, 0.00),
  ( 31,  '223', 'FATHIMA JANEESA P', 'UPS', 13125.00, 0.00),
  ( 32,  '222', 'YOUNUS PM', 'UPS', 10500.00, 0.00),
  ( 33,  '262', 'RASAL AMEEN', 'UPS', 12000.00, 0.00),
  ( 34,  '254', 'BINZIYA MOL', 'UPS', 10500.00, 0.00),
  ( 35,  '191', 'MUFEEDA', 'LPS', 11025.00, 0.00),
  ( 36,  '159', 'SARITHA TP', 'LPS', 10527.00, 1000.00),
  ( 37,  '192', 'SHAIMA P', 'LPS', 9975.00, 0.00),
  ( 38,  '112', 'HAJARA CP', 'LPS', 12075.00, 0.00),
  ( 39,  '240', 'THASNEEM LATHEEF KK', 'LPS', 10000.00, 0.00),
  ( 40,  '119', 'BIVINA TP', 'LPS', 12156.00, 0.00),
  ( 41,  '224', 'SULFATH OK', 'LPS', 9975.00, 0.00),
  ( 42,  '225', 'SHAZIYA CT', 'LPS', 12500.00, 0.00),
  ( 43,  '154', 'MUBASHIRA VM', 'LPS', 10500.00, 0.00),
  ( 44,  '272', 'MURSHIDA M', 'LPS', 10000.00, 0.00),
  ( 45,  '273', 'HAFEEFA YASMIN N', 'LPS', 10000.00, 0.00),
  ( 46,  '265', 'RISVANA CP', 'LPS', 10000.00, 0.00),
  ( 47,  '266', 'AYSHA HASNA', 'LPS', 10000.00, 0.00),
  ( 48,  '274', 'SABITHA SHERIN', 'LPS', 10000.00, 0.00),
  ( 49,  '267', 'SAIFUNNISA', 'LPS', 13500.00, 0.00),
  ( 50,  '270', 'MUFEEDA THASNI', 'LPS', 10000.00, 0.00),
  ( 51,  '277', 'RASILI P', 'LPS', 11000.00, 0.00),
  ( 52,   '35', 'SUSHEENA', 'KG', 15750.00, 0.00),
  ( 53,  '103', 'SHAIMA ALI AK', 'KG', 11100.00, 500.00),
  ( 54,  '155', 'RUKIYA O', 'KG', 11900.00, 3000.00),
  ( 55,  '118', 'FARIJA CK', 'KG', 11576.00, 0.00),
  ( 56,  '151', 'SABNA T', 'KG', 10500.00, 0.00),
  ( 57,  '215', 'FASEELA KC', 'KG', 10500.00, 0.00),
  ( 58,  '153', 'SAREENA K', 'KG', 10999.00, 0.00),
  ( 59,  '218', 'RAJEESHMA PP', 'KG', 10500.00, 0.00),
  ( 60,  '236', 'HISANA KP', 'KG', 9250.00, 0.00),
  ( 61,  '275', 'FAHMIDA BANU A', 'KG', 10000.00, 0.00),
  ( 62,  '276', 'HAJARABI CP', 'KG', 11000.00, 0.00),
  ( 63,  '269', 'RASHIDA AC', 'KG', 9000.00, 0.00),
  ( 64,  '279', 'FATHIMA SUHRA M', 'KG', 10000.00, 0.00),
  ( 65,  '271', 'RAIHANATH', 'KG', 9000.00, 0.00),
  ( 66,  '187', 'ANAS WAFY', 'Sadar Muallim', 15750.00, 0.00),
  ( 67,   '29', 'HABEEB RAHMAN PP', 'Teacher', 12414.00, 0.00),
  ( 68,   '30', 'NAVAS T', 'Teacher', 12414.00, 0.00),
  ( 69,   '40', 'ABDUL SALAM CV', 'Teacher', 12414.00, 0.00),
  ( 70,   '45', 'SALMANUL FARIS PK', 'Teacher', 12414.00, 0.00),
  ( 71,  '122', 'MOHAMED KABEER MK', 'Teacher', 11025.00, 0.00),
  ( 72,  '184', 'FAWAS THANGAL', 'Teacher', 10763.00, 0.00),
  ( 73,   NULL, 'UBAIDULLAH B', 'Teacher', 10000.00, 0.00),
  ( 74,  '242', 'MUHAMMED FAYIZ MK', 'Teacher', 10500.00, 0.00),
  ( 75,  '249', 'UBAID K', 'Teacher', 15750.00, 0.00),
  ( 76,  '250', 'SHIHABUDHEEN T', 'Teacher', 10500.00, 0.00),
  ( 77,  '261', 'MUHAMMED SHABEER', 'Teacher', 10000.00, 0.00),
  ( 78,   NULL, 'MAJEED FAIZY', 'Teacher', 10000.00, 0.00),
  ( 79,  '278', 'RABEEHA RAIHAN WAFIYA', 'Teacher', 10000.00, 0.00),
  ( 80,    '6', 'KARTHIYANI NP', 'AYA', 9492.00, 0.00),
  ( 81,   '23', 'SUMALATHA NP', 'AYA', 8337.00, 0.00),
  ( 82,   '27', 'SHAINI KP', 'AYA', 8106.00, 0.00),
  ( 83,  '207', 'SUMATHI', 'AYA', 6038.00, 0.00),
  ( 84,  '173', 'KADEEJA', 'AYA', 6300.00, 0.00),
  ( 85,  '128', 'RAHMATHUNNISA K', 'AYA', 6510.00, 0.00),
  ( 86,  '166', 'AYISHA', 'AYA', 6300.00, 0.00),
  ( 87,  '178', 'RAJITHA', 'AYA', 6300.00, 0.00),
  ( 88,  '256', 'BEENA', 'AYA', 5775.00, 0.00),
  ( 89,  '260', 'JAMSIYA', 'AYA', 5500.00, 0.00),
  ( 90,   NULL, 'SUNU', 'AYA', 5500.00, 0.00),
  ( 91,  '206', 'ALI M', 'Security', 11025.00, 0.00),
  ( 92,   '15', 'SADIQUE VC', 'MANAGER', 12285.00, 2500.00),
  ( 93,    '2', 'MUSTHAFA KALLAN', 'Driver', 15954.00, 0.00),
  ( 94,   '24', 'RIYAS AK', 'Driver', 12414.00, 0.00),
  ( 95,   '71', 'MOHAMED MUSTHAFA T', 'Driver', 12684.00, 2500.00),
  ( 96,   '46', 'ABDUL AZEEZ AK', 'Driver', 12359.00, 0.00),
  ( 97,  '135', 'MOHAMMED VT', 'Driver', 11288.00, 0.00),
  ( 98,  '170', 'AYUB V', 'Driver', 10500.00, 0.00),
  ( 99,  '204', 'HASSAN', 'Driver', 11550.00, 0.00),
  (100,  '208', 'KABEER', 'Driver', 9975.00, 0.00),
  (101,  '210', 'ABDUL RASHEED', 'Driver', 11550.00, 2000.00),
  (102,   '76', 'ZAKARIYA O', 'Driver', 9975.00, 0.00),
  (103,  '248', 'MOHAMED SHAFI', 'Driver', 11550.00, 2500.00),
  (104,  '247', 'MAMMI OLAMBIL', 'Driver', 9975.00, 0.00),
  (105,  '169', 'SAIDALAVI', 'Cleaner', 6038.00, 0.00),
  (106,  '174', 'FAYIS', 'Cleaner', 5250.00, 0.00),
  (107,  '209', 'HASEEB', 'Cleaner', 5775.00, 0.00),
  (108,  '211', 'ABDUL KAREEM TT', 'Cleaner', 5775.00, 0.00),
  (109,   '79', 'MUSTHAFA KUNNATH', 'Cleaner', 7692.00, 0.00),
  (110,  '258', 'ANAS', 'Cleaner', 5250.00, 0.00)
    ) AS t(sl, code, name, designation, basic, allowance)
    ORDER BY sl
  LOOP
    SELECT id INTO v_id FROM public.staff
     WHERE institution = 'pmsa' AND unit_id = v_unit AND upper(name) = upper(r.name)
     LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO public.staff (institution, unit_id, code, name, designation, basic_salary, active)
      VALUES ('pmsa', v_unit, r.code, r.name, r.designation, r.basic, true)
      RETURNING id INTO v_id;
      v_new := v_new + 1;
    ELSIF r.code IS NOT NULL THEN
      UPDATE public.staff SET code = r.code WHERE id = v_id AND code IS DISTINCT FROM r.code;
    END IF;

    INSERT INTO public.salary_revisions (institution, staff_id, basic_salary, effective_from)
    VALUES ('pmsa', v_id, r.basic, v_from)
    ON CONFLICT (staff_id, effective_from) DO UPDATE SET basic_salary = excluded.basic_salary;

    IF r.allowance > 0 AND NOT EXISTS (
      SELECT 1 FROM public.salary_components
       WHERE staff_id = v_id AND kind = 'allowance' AND name = 'Allowance' AND effective_from = v_from)
    THEN
      INSERT INTO public.salary_components (institution, staff_id, kind, name, amount, effective_from)
      VALUES ('pmsa', v_id, 'allowance', 'Allowance', r.allowance, v_from);
    END IF;
  END LOOP;

  RAISE NOTICE 'KYHSS Athavanad: % staff added', v_new;
END
$kyhss$;

-- Check: headcount, staff IDs filled, basic pay and allowances on the unit.
select count(*)                            as staff,
       count(s.code)                       as with_staff_id,
       sum(s.basic_salary)                 as basic_total,
       (select coalesce(sum(amount), 0) from public.salary_components c
         where c.kind = 'allowance'
           and c.staff_id in (select id from public.staff where unit_id = u.id)) as allowance_total
  from public.staff s
  join public.units u on u.id = s.unit_id
 where u.institution = 'pmsa' and u.name = 'KYHSS Athavanad'
 group by u.id;
