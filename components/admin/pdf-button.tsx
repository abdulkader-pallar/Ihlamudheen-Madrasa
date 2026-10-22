"use client";

import { createContext, useContext } from "react";
import { FileDown } from "lucide-react";
import { btn } from "@/lib/ui";

// The Accounts shell owns the "this page as a PDF" action (it knows the page
// title, institution and the <main> to read). There is no PDF button in the
// shell's header: each page puts one PdfButton in its own toolbar, next to
// CSV where it has one, so every page offers it exactly once.
export const PdfContext = createContext<{ download: () => void; busy: boolean }>({ download: () => {}, busy: false });

export function PdfButton() {
  const { download, busy } = useContext(PdfContext);
  return (
    <button onClick={download} disabled={busy} className={btn({ variant: "ghost", size: "sm" })}>
      <FileDown size={14} /> {busy ? "Making…" : "PDF"}
    </button>
  );
}
