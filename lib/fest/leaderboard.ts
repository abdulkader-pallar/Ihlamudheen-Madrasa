// Shared types + fetch for the Ihlamudheen Madrasa Fest leaderboard (Phase 5).
// The aggregation runs in the fest_leaderboard() SQL function so the same
// numbers feed the staff leaderboard, the public view, and Stage Mode.

import type { SupabaseClient } from "@supabase/supabase-js"

export interface HouseStanding { id: string; name: string; color: string | null; points: number }
export interface SectionStanding { id: string; name: string; points: number }
export interface IndividualStanding { student_id: string; name: string; reg: string; points: number }

export interface Leaderboard {
  houses: HouseStanding[]
  sections: SectionStanding[]
  individuals: IndividualStanding[]
}

const EMPTY: Leaderboard = { houses: [], sections: [], individuals: [] }

export async function fetchLeaderboard(
  supabase: SupabaseClient,
  editionId: string,
): Promise<{ data: Leaderboard; error: string | null }> {
  if (!editionId) return { data: EMPTY, error: null }
  const { data, error } = await supabase.rpc("fest_leaderboard", { p_edition_id: editionId })
  if (error) return { data: EMPTY, error: error.message }
  const lb = (data ?? EMPTY) as Leaderboard
  return {
    data: {
      houses: lb.houses ?? [],
      sections: lb.sections ?? [],
      individuals: lb.individuals ?? [],
    },
    error: null,
  }
}
