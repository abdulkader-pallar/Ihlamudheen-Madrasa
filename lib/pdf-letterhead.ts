// The letterhead at the top of every Accounts PDF: the institution's logo on
// the left with its short name under it, and the institution's full name, the
// unit the page is about and one line of context centred on the page.
//
// It is drawn, not laid out by a browser, so every position here is measured.
// The logo and the centred text block are centred against each other whichever
// is taller, a long name shrinks to stay on one line (and wraps without
// running into the line below if it still cannot fit), and the rule underneath
// follows the real bottom of the block instead of a fixed y. Kept free of the
// DOM so the output can be rendered and checked outside the browser.
import type jsPDF from "jspdf";

export type LetterheadLogo = { data: string; format: "JPEG" | "PNG"; w: number; h: number } | null;

/** Points to millimetres. */
const mm = (pt: number) => (pt * 25.4) / 72;
/** Helvetica's cap height, as a fraction of the font size. Measuring lines by
 *  their capitals - not by the full em box - is what makes the block look
 *  optically centred against the logo. */
const CAP = 0.717;

const LOGO_H = 20;      // logo height, mm
const LOGO_GAP = 6;     // logo to the centred text, mm (keeps them from touching)
const LABEL_SIZE = 8.5; // short name under the logo, pt
const LABEL_GAP = 3.2;  // logo to its label, mm
const GAP_SUB = 2.8;    // name to unit, mm
const GAP_META = 2.4;   // above the context line, mm
const RULE_GAP = 5.4;   // block to rule, mm

export interface LetterheadOptions {
  logo: LetterheadLogo;
  /** Short name under the logo, e.g. "PMSA" (null = none). */
  logoLabel?: string | null;
  /** The institution's full name, e.g. "PMSA Kattilangadi". */
  title: string;
  /** The unit this page is about, e.g. "KYHSS Athavanad" (null = the whole institution). */
  sub: string | null;
  /** The small line under both, e.g. "Accounts  ·  Generated 22 Oct 2026, 16:40". */
  meta: string;
  /** Letterhead accent, as [r, g, b]. */
  color: [number, number, number];
  /** Page width and side margin, mm. */
  width: number;
  margin: number;
  /** Top of the letterhead, mm. */
  top?: number;
}

/** Draws the letterhead and returns the y of the rule under it, so the caller
 *  can place the page heading from there. */
export function drawLetterhead(doc: jsPDF, o: LetterheadOptions): number {
  const { logo, logoLabel, title, sub, meta, color, width: W, margin: M, top = 12 } = o;

  const capH = (pt: number) => mm(pt) * CAP;
  const logoW = logo ? (logo.w / logo.h) * LOGO_H : 0;
  // The text is centred on the page; it may not reach the logo on either side.
  const cx = W / 2;
  const maxW = W - 2 * (M + logoW + LOGO_GAP);
  const label = logo && logoLabel ? logoLabel.toUpperCase() : null;
  // The label is centred under the logo, so it is shrunk to the logo's width
  // rather than allowed to hang over the margin.
  let labelSize = LABEL_SIZE;
  if (label) {
    doc.setFont("helvetica", "bold");
    doc.setCharSpace(0.5);
    doc.setFontSize(labelSize);
    while (labelSize > 6 && doc.getTextWidth(label) > logoW) {
      labelSize -= 0.25;
      doc.setFontSize(labelSize);
    }
    doc.setCharSpace(0);
  }
  const groupH = logo ? LOGO_H + (label ? LABEL_GAP + capH(labelSize) : 0) : 0;

  // Name: as large as fits on one line, down to a floor; then wrap.
  doc.setFont("helvetica", "bold");
  let titleSize = 18;
  doc.setFontSize(titleSize);
  while (titleSize > 12.5 && doc.getTextWidth(title) > maxW) {
    titleSize -= 0.5;
    doc.setFontSize(titleSize);
  }
  const titleLines: string[] = doc.splitTextToSize(title, maxW);
  const titleLead = mm(titleSize) * 1.02;          // baseline to baseline when it wraps
  const subSize = Math.min(12.5, Math.max(10, titleSize * 0.66));
  const metaSize = 8.6;

  const titleH = titleLines.length * capH(titleSize) + (titleLines.length - 1) * (titleLead - capH(titleSize));
  const blockH = titleH + (sub ? GAP_SUB + capH(subSize) : 0) + GAP_META + capH(metaSize);

  // Centre the shorter of the two against the taller.
  const textTop = top + Math.max(0, (groupH - blockH) / 2);
  const logoTop = top + Math.max(0, (blockH - groupH) / 2);

  if (logo) {
    doc.addImage(logo.data, logo.format, M, logoTop, logoW, LOGO_H);
    if (label) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(labelSize);
      doc.setTextColor(...color);
      doc.setCharSpace(0.5);
      doc.text(label, M + logoW / 2, logoTop + LOGO_H + LABEL_GAP + capH(labelSize), { align: "center" });
      doc.setCharSpace(0);
    }
  }

  let cursor = textTop;
  doc.setTextColor(...color);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(titleSize);
  titleLines.forEach((line, i) => {
    doc.text(line, cx, cursor + capH(titleSize), { align: "center" });
    cursor += i === titleLines.length - 1 ? capH(titleSize) : titleLead;
  });

  if (sub) {
    cursor += GAP_SUB;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(subSize);
    doc.setCharSpace(0.08);
    doc.text(sub, cx, cursor + capH(subSize), { align: "center" });
    doc.setCharSpace(0);
    cursor += capH(subSize);
  }

  cursor += GAP_META;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(metaSize);
  doc.setTextColor(118);
  doc.setCharSpace(0.12);
  doc.text(meta, cx, cursor + capH(metaSize), { align: "center" });
  doc.setCharSpace(0);

  // Rule: the accent, with a hairline under it.
  const ruleY = top + Math.max(groupH, blockH) + RULE_GAP;
  doc.setDrawColor(...color);
  doc.setLineWidth(0.7);
  doc.line(M, ruleY, W - M, ruleY);
  doc.setDrawColor(206);
  doc.setLineWidth(0.2);
  doc.line(M, ruleY + 1.3, W - M, ruleY + 1.3);

  return ruleY;
}
