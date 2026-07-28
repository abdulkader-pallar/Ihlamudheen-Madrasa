// ╔══════════════════════════════════════════════════════════════════╗
// ║ Meelad Fest — default item catalog + scoring rubrics (§6B, §3) ║
// ║                                                                    ║
// ║ The seed catalog an admin can drop into a fresh edition in one     ║
// ║ click. Each item carries a default rubric (the per-criterion       ║
// ║ score sheet judges fill in Phase 4); criteria sum to 100 so grade  ║
// ║ thresholds in editions.config (A≥80/B≥60/C≥40) apply directly.     ║
// ╚══════════════════════════════════════════════════════════════════╝

import type { SupabaseClient } from "@supabase/supabase-js"
import { FEST_ITEM_CATALOG, type ItemLanguage, type ItemType } from "./items"

export interface RubricCriterion {
  key: string
  label: string
  max: number
}

/** Rubric presets keyed by item "profile" (§3 default scoring). */
const RUBRICS: Record<string, RubricCriterion[]> = {
  speech: [
    { key: "content", label: "Content", max: 40 },
    { key: "presentation", label: "Presentation", max: 30 },
    { key: "confidence", label: "Confidence", max: 30 },
  ],
  recitation: [
    { key: "memorization", label: "Memorization", max: 40 },
    { key: "pronunciation", label: "Pronunciation", max: 40 },
    { key: "presentation", label: "Presentation", max: 20 },
  ],
  song: [
    { key: "pronunciation", label: "Pronunciation", max: 35 },
    { key: "presentation", label: "Presentation", max: 35 },
    { key: "creativity", label: "Creativity", max: 30 },
  ],
  story: [
    { key: "content", label: "Content", max: 40 },
    { key: "presentation", label: "Presentation", max: 30 },
    { key: "confidence", label: "Confidence", max: 30 },
  ],
  art: [
    { key: "creativity", label: "Creativity", max: 50 },
    { key: "presentation", label: "Presentation", max: 50 },
  ],
  general: [
    { key: "content", label: "Content", max: 50 },
    { key: "presentation", label: "Presentation", max: 50 },
  ],
}

/** Map a canonical item name to its rubric profile. */
export function rubricProfile(name: string): keyof typeof RUBRICS {
  const n = name.toLowerCase()
  if (n.startsWith("speech")) return "speech"
  if (n.includes("quran") || n.includes("hifz") || n.includes("adhan")) return "recitation"
  if (n.startsWith("song") || n.includes("nasheed") || n.includes("duff")) return "song"
  if (n.includes("story")) return "story"
  if (n.includes("calligraphy") || n.includes("drawing") || n.includes("flower")) return "art"
  return "general"
}

/** The default rubric for an item — used when seeding or hand-creating items. */
export function defaultRubric(name: string): RubricCriterion[] {
  return RUBRICS[rubricProfile(name)]
}

export interface DefaultItem {
  name: string
  language: ItemLanguage
  type: ItemType
  rubric: RubricCriterion[]
}

/** The full seed catalog, each entry with its default rubric attached. */
export const DEFAULT_ITEMS: DefaultItem[] = FEST_ITEM_CATALOG.map((i) => ({
  name: i.name,
  language: i.language,
  type: i.type,
  rubric: defaultRubric(i.name),
}))

/**
 * Insert any default catalog items missing from an edition. Idempotent: runs as
 * the signed-in admin/staff (fest RLS), skips names already present.
 */
export async function seedDefaultCatalog(
  supabase: SupabaseClient,
  editionId: string,
): Promise<{ created: number }> {
  const { data: existing, error } = await supabase
    .from("fest_items")
    .select("name")
    .eq("edition_id", editionId)
  if (error) throw new Error(`items fetch: ${error.message}`)
  const have = new Set((existing ?? []).map((r) => String(r.name).toLowerCase()))

  const rows = DEFAULT_ITEMS.filter((d) => !have.has(d.name.toLowerCase())).map((d) => ({
    edition_id: editionId,
    name: d.name,
    language: d.language,
    type: d.type,
    rubric: d.rubric,
    group_min: d.type === "group" ? 2 : null,
  }))
  if (!rows.length) return { created: 0 }

  const { data, error: insErr } = await supabase.from("fest_items").insert(rows).select("id")
  if (insErr) throw new Error(`items insert: ${insErr.message}`)
  return { created: data?.length ?? 0 }
}
