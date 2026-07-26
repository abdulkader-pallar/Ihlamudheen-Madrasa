-- Rename Ihlamudheen Madrasa EDU SUPPORT classes from "Grade: ES G<n>" → "Grade <n>"
-- so the fee tier regex (grade\s*[12], grade\s*[34], grade\s*[56]) can match correctly.
-- Fees: Grade 1 & 2 = AED 300 | Grade 3 & 4 = AED 350 | Grade 5 & 6 = AED 400

UPDATE public.classes
SET name = 'Grade ' || (regexp_match(name, '(?i)g(\d+)\s*$'))[1]
WHERE course_id = '4'
  AND name ~* 'g\d+\s*$';
