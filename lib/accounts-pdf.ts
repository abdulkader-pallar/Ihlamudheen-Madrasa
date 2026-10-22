// "Download PDF" for every Accounts page. Rather than each page describing its
// own PDF, this reads what the page is showing: the summary cards (StatCard,
// tagged data-pdf-stat) and every table, each under the title of the Panel
// it sits in (data-pdf-title). Anything marked .no-print (toolbars, action
// buttons) is left out; inputs export their current value.
//
// Every PDF opens with the institution's letterhead: its logo, full name,
// the page and the selected institution (see lib/sites.ts).
import type { Site } from "@/lib/sites";
import { drawLetterhead, type LetterheadLogo } from "@/lib/pdf-letterhead";

type Cell = { content: string; colSpan?: number; styles?: { halign?: "left" | "right" | "center" } };
type Section = { title: string | null; head: Cell[][]; body: Cell[][]; foot: Cell[][] };

// jsPDF's built-in fonts only cover Latin-1, so swap the few symbols the
// portal uses that they can't draw.
const clean = (s: string) =>
  s
    .replace(/₹\s?/g, "Rs. ")
    .replace(/[−–]/g, "-")
    .replace(/—/g, " - ")
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Visible text of a cell: input/select values, without buttons or .no-print. */
function cellText(el: Element) {
  const c = el.cloneNode(true) as HTMLElement;
  const src = el.querySelectorAll("input, select, textarea");
  c.querySelectorAll("input, select, textarea").forEach((n, i) => {
    const s = src[i] as HTMLInputElement | HTMLSelectElement;
    const v = s instanceof HTMLSelectElement ? s.selectedOptions[0]?.text ?? "" : s.value;
    n.replaceWith(document.createTextNode(v));
  });
  c.querySelectorAll("button, svg, .no-print").forEach((n) => n.remove());
  // Lines stacked in one cell (name, then designation) → "Name · Designation".
  c.querySelectorAll("div, p").forEach((n) => n.previousSibling && n.before(document.createTextNode(" · ")));
  return clean(c.textContent || "");
}

function readTable(t: HTMLTableElement): Section {
  const right = new Set<number>();
  t.querySelectorAll("thead tr:first-child > th").forEach((th, i) => th.classList.contains("text-right") && right.add(i));
  const rows = (sel: string) =>
    Array.from(t.querySelectorAll<HTMLTableRowElement>(sel)).map((tr) => {
      let col = 0;
      const out: Cell[] = [];
      for (const td of Array.from(tr.cells)) {
        const span = td.colSpan || 1;
        if (!td.classList.contains("no-print")) {
          const halign = td.classList.contains("text-right") || (span === 1 && right.has(col)) ? "right" : undefined;
          out.push({ content: cellText(td), ...(span > 1 ? { colSpan: span } : {}), ...(halign ? { styles: { halign } } : {}) });
        }
        col += span;
      }
      return out;
    }).filter((r) => r.some((c) => c.content));
  const panel = t.closest("[data-pdf-title]");
  return { title: panel ? clean(panel.getAttribute("data-pdf-title") || "") : null, head: rows("thead tr"), body: rows("tbody tr"), foot: rows("tfoot tr") };
}

async function logoData(src: string): Promise<LetterheadLogo> {
  try {
    const img = new Image();
    img.src = encodeURI(src);
    await img.decode();
    const scale = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext("2d")!;
    // JPEG on white keeps the PDF small (a PNG logo alone is ~400 KB in jsPDF).
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/jpeg", 0.92), format: "JPEG", w: c.width, h: c.height };
  } catch {
    return null; // a missing logo shouldn't stop the download
  }
}

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export async function downloadAccountsPdf({ root, site, title, scope, preview }: { root: HTMLElement; site: Site; title: string; scope: string; preview?: boolean }) {
  const visible = (el: Element) => !el.closest(".no-print");
  const stats = Array.from(root.querySelectorAll<HTMLElement>("[data-pdf-stat]")).filter(visible).map((el) => ({
    label: clean(el.dataset.label || ""), value: clean(el.dataset.value || ""), sub: clean(el.dataset.sub || ""),
  }));
  const sections = Array.from(root.querySelectorAll("table")).filter(visible).map(readTable).filter((s) => s.head.length || s.body.length);
  if (!stats.length && !sections.length) throw new Error("Nothing on this page to put in a PDF yet.");

  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import("jspdf"), import("jspdf-autotable"), logoData(site.pdfLogo),
  ]);
  const widest = Math.max(0, ...sections.map((s) => Math.max(...[...s.head, ...s.body].map((r) => r.reduce((a, c) => a + (c.colSpan || 1), 0)))));
  // Always portrait; wide tables (payroll, the financial-year grid) get a
  // smaller font so they still fit across the page.
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const fontSize = widest > 9 ? 6.5 : widest > 7 ? 7.2 : widest > 5 ? 8 : 8.5;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const color = hexRgb(site.pdfColor);
  const generated = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  // A PMSA institution (KYHSS Athavanad, Yatheem Khana, …) is the name in the
  // middle of the letterhead, with the trust's own short name under the logo,
  // so neither the heading nor the centre repeats the other.
  const sub = scope !== site.name ? clean(scope) : null;
  const heading = sub ? clean(title) : clean(`${title} - ${scope}`);

  // Letterhead
  const ruleY = drawLetterhead(doc, {
    // The trust's short name goes under the logo when the middle names one of
    // its institutions; with the trust itself in the middle it would say the
    // same thing twice.
    logo, logoLabel: sub ? clean(site.name) : null,
    // The institution this page is about takes the middle: the unit when one
    // is selected, otherwise the trust itself.
    title: sub ?? clean(site.fullName), sub: null,
    meta: `Accounts  \xB7  Generated ${generated}`,
    color, width: W, margin: M,
  });

  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(heading, W / 2, ruleY + 9, { align: "center" });
  let y = ruleY + 15;

  // Summary cards, four to a row
  if (stats.length) {
    const per = Math.min(4, stats.length);
    const gap = 4;
    const bw = (W - 2 * M - gap * (per - 1)) / per;
    stats.forEach((s, i) => {
      const bx = M + (i % per) * (bw + gap);
      const by = y + Math.floor(i / per) * 22;
      doc.setDrawColor(215);
      doc.setLineWidth(0.3);
      doc.roundedRect(bx, by, bw, 19, 2, 2);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(110);
      doc.text(s.label, bx + 3, by + 5.5, { maxWidth: bw - 6 });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(20);
      doc.text(s.value, bx + 3, by + 12, { maxWidth: bw - 6 });
      if (s.sub) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(130);
        doc.text(s.sub, bx + 3, by + 16.5, { maxWidth: bw - 6 });
      }
    });
    y += Math.ceil(stats.length / per) * 22 + 3;
  }

  // Tables
  for (const s of sections) {
    if (y > H - 40) { doc.addPage(); y = 22; }
    // Wide tables in portrait: drop "Rs." from every amount so figures stay on
    // one line, and say once that amounts are in rupees.
    const cols = Math.max(...[...s.head, ...s.body].map((r) => r.reduce((a, c) => a + (c.colSpan || 1), 0)));
    const bare = cols > 6;
    const strip = (rows: Cell[][]) => (bare ? rows.map((r) => r.map((c) => ({ ...c, content: c.content.replace(/Rs\. /g, "") }))) : rows);
    const titleText = s.title || bare;
    if (titleText) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...color);
      if (s.title) doc.text(s.title, M, y + 4);
      if (bare) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(110);
        doc.text("Amounts in Rs.", W - M, y + 4, { align: "right" });
      }
      y += 7;
    }
    autoTable(doc, {
      startY: y,
      head: s.head,
      body: strip(s.body),
      foot: strip(s.foot),
      showFoot: "lastPage",
      margin: { left: M, right: M, top: 22, bottom: 16 },
      styles: { fontSize, cellPadding: fontSize < 8 ? 1.3 : 1.8, textColor: 30, lineColor: 225, lineWidth: 0.1 },
      headStyles: { fillColor: color, textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [238, 241, 245], textColor: 20, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 249, 251] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 9;
  }

  // Running header (pages 2+) and page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    if (i > 1) {
      doc.text([clean(site.fullName), sub, heading].filter(Boolean).join(" - "), W / 2, 12, { align: "center" });
      doc.setDrawColor(...color);
      doc.setLineWidth(0.4);
      doc.line(M, 14.5, W - M, 14.5);
    }
    doc.text(`Generated ${generated}`, M, H - 8);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 8, { align: "right" });
  }

  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const filename = `${slug(site.name)}-${slug(title)}${scope !== site.name ? "-" + slug(scope) : ""}-${new Date().toLocaleDateString("en-CA")}.pdf`;
  // preview: hand the PDF back to be shown on screen (PdfPreview) instead of
  // dropping it straight into Downloads.
  if (preview) return { blob: doc.output("blob") as Blob, filename };
  doc.save(filename);
}
