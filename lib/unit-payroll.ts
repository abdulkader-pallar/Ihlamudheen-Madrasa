// Salary maths for unit payroll (Accounts portal, /admin/payroll). Pure
// functions, no React. Money is worked in whole paise so totals never pick up
// floating-point drift; convert back with fromPaise() only for display/saving.
import type { PayrollLine, SalaryComponent, SalaryRevision, Staff } from "@/lib/types";

export const toPaise = (n: number | string | null | undefined) => Math.round((Number(n) || 0) * 100);
export const fromPaise = (p: number) => p / 100;
/** Sum amounts exactly (via paise). */
export const sumMoney = (xs: (number | string | null | undefined)[]) => fromPaise(xs.reduce<number>((s, x) => s + toPaise(x), 0));

/** "2026-10" → first/last day and day count. */
export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}`, days };
}

export const monthName = (month: string) =>
  new Date(month + "-01T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** Indian financial year (April–March) containing `month`, e.g. 2026-10 → 2026. */
export const fyOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m >= 4 ? y : y - 1;
};
/** The twelve months of FY `start` (April `start` … March `start+1`). */
export const fyMonths = (start: number) =>
  Array.from({ length: 12 }, (_, i) => {
    const d = new Date(start, 3 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
export const fyLabel = (start: number) => `FY ${start}–${String(start + 1).slice(2)}`;

/** Basic salary in force for `month`: the latest revision starting on or before
 *  its last day, else the staff member's current basic. */
export function basicFor(s: Staff, revisions: SalaryRevision[], month: string) {
  const { last } = monthBounds(month);
  const rev = revisions
    .filter((r) => r.staff_id === s.id && r.effective_from <= last)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  return toPaise(rev ? rev.basic_salary : s.basic_salary);
}

/** Recurring items that apply in any part of `month`. */
export function componentsFor(staffId: string, comps: SalaryComponent[], month: string) {
  const { first, last } = monthBounds(month);
  return comps.filter((c) => c.staff_id === staffId && c.effective_from <= last && (!c.effective_to || c.effective_to >= first));
}

/** Days in `month` the person was on the rolls (joined/left mid-month). */
export function daysWorked(s: Staff, month: string) {
  const { first, last, days } = monthBounds(month);
  const start = s.joined_on && s.joined_on > first ? s.joined_on : first;
  const end = s.left_on && s.left_on < last ? s.left_on : last;
  if (start > last || end < first || start > end) return 0;
  const d = (iso: string) => new Date(iso + "T00:00:00").getTime();
  return Math.min(days, Math.round((d(end) - d(start)) / 86400000) + 1);
}

/** Full-month amounts in paise (before pro-rating). */
export function monthlyPay(s: Staff, revisions: SalaryRevision[], comps: SalaryComponent[], month: string) {
  const items = componentsFor(s.id, comps, month);
  const total = (k: SalaryComponent["kind"]) => items.filter((c) => c.kind === k).reduce((a, c) => a + toPaise(c.amount), 0);
  return { basic: basicFor(s, revisions, month), allowances: total("allowance"), deductions: total("deduction"), employer: total("employer") };
}

/** What one staff member costs the institution for a full month at their
 *  current pay: gross (basic + allowances) + employer contributions. */
export function monthlyCost(s: Staff, revisions: SalaryRevision[], comps: SalaryComponent[], month: string) {
  const p = monthlyPay(s, revisions, comps, month);
  return p.basic + p.allowances + p.employer;
}

type LineInput = Pick<PayrollLine, "days_in_month" | "days_worked" | "basic" | "allowances" | "deductions" | "employer" | "bonus" | "other_deduction">;

/** Gross, net and cost for a line. Basic/allowances/deductions/employer are
 *  full-month figures, pro-rated by days worked; bonus and other deductions
 *  are one-off amounts for this month. Inputs and outputs are rupees. */
export function computeLine(l: LineInput) {
  const share = l.days_in_month ? l.days_worked / l.days_in_month : 0;
  const pr = (x: number) => Math.round(toPaise(x) * share);
  const gross = pr(l.basic) + pr(l.allowances) + toPaise(l.bonus);
  const deductions = pr(l.deductions) + toPaise(l.other_deduction);
  const employer = pr(l.employer);
  return { gross: fromPaise(gross), net: fromPaise(gross - deductions), cost: fromPaise(gross + employer), deductionsTotal: fromPaise(deductions), employerTotal: fromPaise(employer) };
}

/** A fresh payroll line for `s` in `month`, or null if not on the rolls then. */
export function draftLine(s: Staff, revisions: SalaryRevision[], comps: SalaryComponent[], month: string) {
  const worked = daysWorked(s, month);
  if (worked === 0) return null;
  const p = monthlyPay(s, revisions, comps, month);
  const base = {
    staff_id: s.id,
    staff_name: s.name,
    designation: s.designation,
    days_in_month: monthBounds(month).days,
    days_worked: worked,
    basic: fromPaise(p.basic),
    allowances: fromPaise(p.allowances),
    deductions: fromPaise(p.deductions),
    employer: fromPaise(p.employer),
    bonus: 0,
    other_deduction: 0,
    note: worked < monthBounds(month).days ? `Pro-rated: ${worked} days` : null,
  };
  const { gross, net, cost } = computeLine(base);
  return { ...base, gross, net, cost };
}
