import { todayISO } from "./format";

type Cell = string | number | null | undefined;

export function downloadCSV(filename: string, rows: Cell[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          // Numbers are safe to emit as-is (keeps amounts numeric in Excel).
          if (typeof cell === "number") return String(cell);
          let s = String(cell ?? "");
          // Neutralise spreadsheet formula injection: a text cell that starts
          // with = + - @ (or tab/CR) can execute as a formula when opened in
          // Excel/Sheets. Prefix it with a quote so it's treated as text.
          if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
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
