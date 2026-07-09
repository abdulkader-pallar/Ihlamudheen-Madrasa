export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

export const inputClass =
  "w-full rounded-[11px] border-[1.5px] border-line bg-surface-2 px-3.5 py-2.5 text-[15px] text-ink outline-none transition focus:border-brand";
export const labelClass = "mb-1.5 block text-[13px] font-bold";

type BtnOpts = {
  variant?: "primary" | "ghost" | "gold" | "danger";
  size?: "sm" | "md" | "lg";
};

export function btn({ variant = "primary", size = "md" }: BtnOpts = {}) {
  const base =
    "inline-flex items-center justify-center font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-600 hover:-translate-y-0.5",
    ghost: "border-[1.5px] border-line text-ink hover:border-brand hover:text-brand hover:-translate-y-0.5",
    gold: "bg-accent text-[#3a2a05] hover:brightness-105 hover:-translate-y-0.5",
    danger: "border-[1.5px] border-bad text-bad hover:bg-bad-bg",
  }[variant];
  const sizes = {
    sm: "gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px]",
    md: "gap-2 rounded-[11px] px-4 py-2.5 text-sm",
    lg: "gap-2.5 rounded-full px-6 py-3 text-[15px]",
  }[size];
  return cx(base, variants, sizes);
}
