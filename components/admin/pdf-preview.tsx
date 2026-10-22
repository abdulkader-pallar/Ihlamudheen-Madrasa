"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Printer, X } from "lucide-react";
import { btn } from "@/lib/ui";

// The PDF of an Accounts page is shown here first - on screen, at full size -
// so it can be read before it is saved. From here it is either downloaded or
// sent to the printer; nothing reaches Downloads until Download is clicked.
export function PdfPreview({ blob, filename, onClose }: { blob: Blob; filename: string; onClose: () => void }) {
  // The object URL is made and released by the same effect, so React's
  // development double-run (mount, clean up, mount) can't release the one the
  // page is still showing.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  const frame = useRef<HTMLIFrameElement>(null);
  // Phone browsers don't render a PDF in an iframe; they offer to save it
  // instead, so there the preview is replaced by a plain "open it" card.
  // Decided before the first paint: an iframe shown even for a moment can
  // start that download. (This dialog only ever renders in the browser.)
  const [embeds] = useState(() => typeof navigator === "undefined" || !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const download = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  };

  // Print the PDF where the viewer allows it; otherwise open it in a tab,
  // which has a print button of its own.
  const print = () => {
    if (!url) return;
    const w = frame.current?.contentWindow;
    try {
      if (!w) throw new Error("no frame");
      w.focus();
      w.print();
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/70 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="PDF preview"
        className="mx-auto flex h-full w-full max-w-[1000px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[17px] font-semibold leading-tight">PDF preview</h3>
            <p className="truncate text-[12px] text-muted">{filename}</p>
          </div>
          <button onClick={print} className={btn({ variant: "ghost", size: "sm" })}><Printer size={15} /> Print</button>
          <button onClick={download} className={btn({ variant: "primary", size: "sm" })}><Download size={15} /> Download</button>
          <button onClick={onClose} aria-label="Close preview"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
            <X size={17} />
          </button>
        </div>
        {!url ? (
          <div className="flex-1 bg-surface-2" />
        ) : embeds ? (
          <iframe ref={frame} src={url} title="PDF preview" className="h-full w-full flex-1 bg-surface-2" />
        ) : (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <p className="max-w-[320px] text-[14px] text-muted">
              Your phone can&apos;t show the PDF here. <b className="text-ink">Download</b> it, or
              {" "}
              <a href={url} target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--brand)] underline">open it in a new tab</a>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
