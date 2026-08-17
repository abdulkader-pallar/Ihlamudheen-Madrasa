// Shared layout helpers.
//
// Lives under components/ rather than lib/ on purpose: tailwind.config.ts only
// scans ./app and ./components, so class-name literals placed in lib/ would be
// dropped from the generated CSS and silently render unstyled.

/**
 * Column classes that never leave a half-empty row.
 *
 * A fixed `sm:grid-cols-2 lg:grid-cols-3` looks right only when the list is
 * full. With one item it parks a card in the first third and leaves the rest of
 * the row blank — which is what the dashboard's institution and course grids
 * were doing. These scales only step up to N columns once there are N items to
 * put in them, so a lone card fills its row.
 *
 * Every value is written out in full because Tailwind matches whole class
 * strings; building them by interpolation would produce classes that never make
 * it into the stylesheet.
 */
const SCALES = {
  2: [
    "grid-cols-1",
    "grid-cols-1 sm:grid-cols-2",
  ],
  3: [
    "grid-cols-1",
    "grid-cols-1 sm:grid-cols-2",
    "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  ],
  4: [
    "grid-cols-1",
    "grid-cols-1 sm:grid-cols-2",
    "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  ],
} as const

export function gridCols(count: number, max: 2 | 3 | 4 = 3): string {
  const scale = SCALES[max]
  // A caller passing `items?.length` on an undefined list yields NaN, which
  // would index past the scale and put the string "undefined" in className.
  // Treat anything that is not a real number as a single item.
  const n = Number.isFinite(count) ? count : 1
  const i = Math.min(Math.max(n, 1), scale.length) - 1
  return scale[i]
}
