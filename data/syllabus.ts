// ╔══════════════════════════════════════════════════════════════════╗
// ║ Ihlamudheen Syllabus 2027-28                                           ║
// ║ Source: പുതിയ_സിലബസ്_ജനറൽ_മദ്റസ_2026_27_new.pdf                ║
// ║ (Monthly syllabus for general madrasas under the religious       ║
// ║ education committee of Karbala)                                  ║
// ║                                                                  ║
// ║ Each subject is worth a flat 50 marks (per teacher's instruction)║
// ║ Portions are split into:                                         ║
// ║   • Half-Yearly  — content from months 1-5 (Shawwal → Safar)     ║
// ║   • Final Year   — full annual syllabus                          ║
// ║                                                                  ║
// ║ Bilingual labels (English + Arabic) drive the flip-card UI on    ║
// ║ the Grade Book page.                                             ║
// ╚══════════════════════════════════════════════════════════════════╝

export interface SyllabusSubject {
  id: string                                       // stable id used as exam_subjects.id
  enName: string
  arName: string
  halfYearlyPortion: { en: string; ar: string }
  finalYearPortion: { en: string; ar: string }
  maxScore: 50
}

export interface GradeSyllabus {
  grade: number                                    // 1-10
  classIds: string[]                               // matches courses.ts class ids
  enLabel: string                                  // "Grade 1", "Grade 2A", …
  arLabel: string                                  // "للصف الأول", …
  subjects: SyllabusSubject[]
}

const sub = (
  id: string,
  enName: string,
  arName: string,
  hyEn: string,
  hyAr: string,
  fyEn: string,
  fyAr: string
): SyllabusSubject => ({
  id,
  enName,
  arName,
  halfYearlyPortion: { en: hyEn, ar: hyAr },
  finalYearPortion: { en: fyEn, ar: fyAr },
  maxScore: 50,
})

// ── Subjects shared across most grades ────────────────────────────
const stdAqeeda = (gid: string) =>
  sub(`${gid}_aqeeda`, "Aqeeda (Beliefs)", "العقيدة",
    "Lessons 1–5", "الدروس ١–٥",
    "Lessons 1–10", "الدروس ١–١٠")

const stdFiqh = (gid: string) =>
  sub(`${gid}_fiqh`, "Fiqh (Jurisprudence)", "الفقه",
    "Lessons 1–5", "الدروس ١–٥",
    "Lessons 1–10", "الدروس ١–١٠")

const stdAkhlaq = (gid: string) =>
  sub(`${gid}_akhlaq`, "Akhlaq (Ethics)", "الأخلاق",
    "Lessons 1–5", "الدروس ١–٥",
    "Lessons 1–10", "الدروس ١–١٠")

const stdTarikh = (gid: string) =>
  sub(`${gid}_tarikh`, "Tarikh (Islamic History)", "التاريخ",
    "Lessons 1–5", "الدروس ١–٥",
    "Lessons 1–10", "الدروس ١–١٠")

const stdTajweed = (gid: string) =>
  sub(`${gid}_tajweed`, "Tajweed", "التجويد",
    "Lessons 1–5", "الدروس ١–٥",
    "Lessons 1–10", "الدروس ١–١٠")

const stdLisanQuran = (gid: string) =>
  sub(`${gid}_lisan`, "Lisan al-Quran", "لسان القرآن",
    "Lessons 1–5", "الدروس ١–٥",
    "Lessons 1–10", "الدروس ١–١٠")

// ── Per-grade syllabus ───────────────────────────────────────────
export const SYLLABUS_2026_27: GradeSyllabus[] = [
  // ─── Grade 1 — Tafhim al-Quran track + Diniyat + Arabic ───────
  {
    grade: 1,
    classIds: ["1a", "1b", "1c"],
    enLabel: "Grade 1",
    arLabel: "للصف الأول",
    subjects: [
      sub("g1_tafhim_p1", "Tafhim al-Quran (Part 1)", "تفهيم القرآن - الجزء الأول",
        "Lessons 17–150 of Tafhim Part 1", "الدروس ١٧–١٥٠ من الجزء الأول",
        "Lessons 17–275 of Tafhim Part 1", "الدروس ١٧–٢٧٥ من الجزء الأول"),
      sub("g1_tafhim_p2", "Tafhim al-Quran (Part 2)", "تفهيم القرآن - الجزء الثاني",
        "Lessons 17–80 of Tafhim Part 2", "الدروس ١٧–٨٠ من الجزء الثاني",
        "Lessons 17–181 of Tafhim Part 2", "الدروس ١٧–١٨١ من الجزء الثاني"),
      sub("g1_diniyat", "Diniyat & Akhlaq", "الديني ات والأخلاق",
        "Topics: Our Prophet ﷺ, Allah Most High, Mother", "الموضوعات: نبينا محمد ﷺ، الله تعالى، الأم",
        "All topics: Prophet ﷺ, Allah, Mother, Father, Teacher, Companions", "جميع الموضوعات: النبي ﷺ، الله، الأم، الأب، الأستاذ، القرناء"),
      sub("g1_arabic_malayalam", "Arabic-Malayalam Lessons", "دروس عربي مليالم",
        "Lessons 1–4", "الدروس ١–٤",
        "Lessons 1–8", "الدروس ١–٨"),
    ],
  },

  // ─── Grade 2 — Quran + Aqeeda + Fiqh + Akhlaq + Tarikh + Tajweed ─
  {
    grade: 2,
    classIds: ["2a", "2b"],
    enLabel: "Grade 2",
    arLabel: "للصف الثاني",
    subjects: [
      sub("g2_quran", "Quran", "القرآن",
        "Surah Al-Fatihah → Surah Al-Burooj", "سورة الفاتحة إلى سورة البروج",
        "Surah Al-Fatihah → Surah An-Nas", "سورة الفاتحة إلى سورة الناس"),
      stdAqeeda("g2"),
      stdFiqh("g2"),
      stdAkhlaq("g2"),
      stdTarikh("g2"),
      stdTajweed("g2"),
    ],
  },

  // ─── Grade 3 ───────────────────────────────────────────────────
  {
    grade: 3,
    classIds: ["3a", "3b"],
    enLabel: "Grade 3",
    arLabel: "للصف الثالث",
    subjects: [
      sub("g3_quran", "Quran", "القرآن",
        "Unit 1 → Unit 5 (Half-yearly portion)", "الوحدة الأولى إلى الوحدة الخامسة",
        "Unit 1 → Unit 10 (full year)", "الوحدة الأولى إلى الوحدة العاشرة"),
      stdAqeeda("g3"),
      stdFiqh("g3"),
      stdAkhlaq("g3"),
      stdTarikh("g3"),
      stdTajweed("g3"),
    ],
  },

  // ─── Grade 4 ───────────────────────────────────────────────────
  {
    grade: 4,
    classIds: ["4a"],
    enLabel: "Grade 4",
    arLabel: "للصف الرابع",
    subjects: [
      sub("g4_quran", "Quran", "القرآن",
        "Surah Al-A'la → Surah Ash-Shams", "سورة الأعلى إلى سورة الشمس",
        "Surah Al-A'la → Surah An-Nas (full year)", "سورة الأعلى إلى سورة الناس",
      ),
      stdAqeeda("g4"),
      stdFiqh("g4"),
      stdAkhlaq("g4"),
      stdTarikh("g4"),
      stdTajweed("g4"),
    ],
  },

  // ─── Grade 5 ───────────────────────────────────────────────────
  {
    grade: 5,
    classIds: ["5a"],
    enLabel: "Grade 5",
    arLabel: "للصف الخامس",
    subjects: [
      sub("g5_quran", "Quran", "القرآن",
        "Surah Al-Anfal selections", "من سورة الأنفال (مختارات)",
        "Surah Al-Anfal → Surah Al-Mu'minoon wa An-Noor", "من الأنفال إلى المؤمنون والنور"),
      stdAqeeda("g5"),
      stdFiqh("g5"),
      stdAkhlaq("g5"),
      stdTarikh("g5"),
      stdTajweed("g5"),
      stdLisanQuran("g5"),
    ],
  },

  // ─── Grade 6 ───────────────────────────────────────────────────
  {
    grade: 6,
    classIds: ["6a"],
    enLabel: "Grade 6",
    arLabel: "للصف السادس",
    subjects: [
      sub("g6_quran", "Quran", "القرآن",
        "Surah Al-Baqarah selections (first half)", "من سورة البقرة (النصف الأول)",
        "Surah Al-Baqarah → Surah Al-A'raf", "من البقرة إلى الأعراف"),
      stdAqeeda("g6"),
      stdFiqh("g6"),
      stdAkhlaq("g6"),
      stdTarikh("g6"),
      stdTajweed("g6"),
      stdLisanQuran("g6"),
    ],
  },

  // ─── Grade 7 — Hifz tracks (Juz numbers) ────────────────────────
  {
    grade: 7,
    classIds: ["7a"],
    enLabel: "Grade 7",
    arLabel: "للصف السابع",
    subjects: [
      sub("g7_quran", "Quran (Hifz)", "القرآن (الحفظ)",
        "Juz 21 → Juz 25", "الجزء ٢١ إلى الجزء ٢٥",
        "Juz 21 → Juz 30 (full year)", "الجزء ٢١ إلى الجزء ٣٠"),
      sub("g7_tafsir", "Tafsir", "التفسير",
        "Surah Al-Waqi'ah selections", "من سورة الواقعة",
        "Surah Al-Waqi'ah → final selections", "سورة الواقعة وما بعدها"),
      stdAqeeda("g7"),
      stdFiqh("g7"),
      stdAkhlaq("g7"),
      stdTarikh("g7"),
      stdLisanQuran("g7"),
    ],
  },

  // ─── Grade 8 — Hifz juz 11-20 ────────────────────────────────
  {
    grade: 8,
    classIds: ["8a"],
    enLabel: "Grade 8",
    arLabel: "للصف الثامن",
    subjects: [
      sub("g8_quran", "Quran (Hifz)", "القرآن (الحفظ)",
        "Juz 11 → Juz 15", "الجزء ١١ إلى الجزء ١٥",
        "Juz 11 → Juz 20 (full year)", "الجزء ١١ إلى الجزء ٢٠"),
      sub("g8_tafsir", "Tafsir", "التفسير",
        "Surah Al-A'la → Surah Al-Fajr", "سورة الأعلى إلى سورة الفجر",
        "Surah Al-A'la → Surah An-Nas (full year)", "من الأعلى إلى الناس"),
      stdAqeeda("g8"),
      stdFiqh("g8"),
      stdAkhlaq("g8"),
      stdTarikh("g8"),
      stdLisanQuran("g8"),
    ],
  },

  // ─── Grade 9 — Tafsir + Fiqh (Shafi'i & Hanafi) + Daroos al-Ihsan ─
  {
    grade: 9,
    classIds: ["9a"],
    enLabel: "Grade 9",
    arLabel: "للصف التاسع",
    subjects: [
      sub("g9_tafsir", "Tafsir", "التفسير",
        "Lessons 1–6", "الدروس ١–٦",
        "Lessons 1–12 (full year)", "الدروس ١–١٢"),
      sub("g9_fiqh_shafii", "Fiqh — Shafi'i", "الفقه - الشَّافعي",
        "Lessons 1–8", "الدروس ١–٨",
        "Lessons 1–17 (full year)", "الدروس ١–١٧"),
      sub("g9_fiqh_hanafi", "Fiqh — Hanafi", "الفقه - الحنفي",
        "Lessons 1–8", "الدروس ١–٨",
        "Lessons 1–15 (full year)", "الدروس ١–١٥"),
      sub("g9_ihsan", "Daroos al-Ihsan", "دروس الإحسان",
        "Lessons 1–7", "الدروس ١–٧",
        "Lessons 1–14 (full year)", "الدروس ١–١٤"),
      sub("g9_tarikh", "Tarikh (Islamic History)", "التاريخ",
        "Lessons 1–11", "الدروس ١–١١",
        "Lessons 1–22 (full year)", "الدروس ١–٢٢"),
      stdLisanQuran("g9"),
    ],
  },

  // ─── Grade 10 ───────────────────────────────────────────────────
  {
    grade: 10,
    classIds: ["10a"],
    enLabel: "Grade 10",
    arLabel: "للصف العاشر",
    subjects: [
      sub("g10_tafsir", "Tafsir", "التفسير",
        "Surah Al-Fatihah & Ad-Dhuha → Al-Fariah & At-Takathur",
        "الفاتحة والضحى إلى القارعة والتكاثر",
        "Full year: Al-Fatihah → Al-Falaq & An-Nas",
        "السنة الكاملة: الفاتحة إلى الفلق والناس"),
      sub("g10_fiqh_shafii", "Fiqh — Shafi'i", "الفقه - الشَّافعي",
        "Lessons 1–8", "الدروس ١–٨",
        "Lessons 1–16 (full year)", "الدروس ١–١٦"),
      sub("g10_fiqh_hanafi", "Fiqh — Hanafi", "الفقه - الحنفي",
        "Lessons 1–9", "الدروس ١–٩",
        "Lessons 1–16 (full year)", "الدروس ١–١٦"),
      sub("g10_ihsan", "Daroos al-Ihsan", "دروس الإحسان",
        "Lessons 1–8", "الدروس ١–٨",
        "Lessons 1–15 (full year)", "الدروس ١–١٥"),
      stdLisanQuran("g10"),
    ],
  },
]

// Look up syllabus for a given class id (eg "2a" → Grade 2 syllabus)
export function syllabusForClassId(classId: string): GradeSyllabus | undefined {
  return SYLLABUS_2026_27.find((g) => g.classIds.includes(classId))
}

// Current academic year label — update this each year before seeding.
export const ACADEMIC_YEAR = "2026-27"

// Default exam dates for the current academic year.
// Teachers can override per-exam via the Edit slide-over.
export const DEFAULT_EXAM_DATES = {
  halfYearly: "2026-12-15",
  finalYear:  "2027-04-15",
}
