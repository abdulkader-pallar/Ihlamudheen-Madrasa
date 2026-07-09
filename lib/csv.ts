import { todayISO } from "./format";

type Cell = string | number | null | undefined;

export function downloadCSV(filename: string, rows: Cell[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
