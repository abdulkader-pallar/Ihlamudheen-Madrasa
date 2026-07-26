// ╔══════════════════════════════════════════════════════════════════╗
// ║ Ihlamudheen Madrasa Fest — .xlsx → matrix adapter                           ║
// ║                                                                    ║
// ║ Thin wrapper over SheetJS that turns an uploaded workbook into the ║
// ║ 2-D matrix that parseFestWorkbook() consumes. Kept separate from   ║
// ║ the (pure, unit-tested) parser so the parser has no file/IO deps.  ║
// ╚══════════════════════════════════════════════════════════════════╝

import * as XLSX from "xlsx"
import type { SheetMatrix } from "./import-fest-excel"

/**
 * Read the first non-empty worksheet of a workbook into a dense matrix.
 * `defval: null` keeps blank cells as null so column positions stay aligned.
 */
export function workbookToMatrix(data: ArrayBuffer | Uint8Array): SheetMatrix {
  const wb = XLSX.read(data, { type: "array" })
  // Pick the sheet with the most rows (the roster sheet; ignores empty tabs).
  let best: SheetMatrix = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const matrix = XLSX.utils.sheet_to_json<SheetMatrix[number]>(ws, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: true,
    }) as unknown as SheetMatrix
    if (matrix.length > best.length) best = matrix
  }
  return best
}
