"use client";

import { useEffect, useId, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "@/lib/ui";
import type { TxType } from "@/lib/types";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Move focus into the dialog for keyboard/screen-reader users.
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button,[tabindex]")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-5 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-card"
      >
        <h3 id={titleId} className="mb-4 font-display text-xl font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Panel({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-2xl border border-line bg-surface p-5 shadow-soft", className)}>
      {title && (
        <h3 className="mb-3.5 flex items-center justify-between gap-2 text-base font-bold">
          {title}
          {action}
        </h3>
      )}
      {children}
    </div>
  );
}

type Accent = "green" | "red" | "blue" | "gold" | "teal";
const ACCENT_COLOR: Record<Accent, string> = {
  green: "var(--good)",
  red: "var(--bad)",
  blue: "#3b82f6",
  gold: "var(--accent)",
  teal: "var(--brand)",
};

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = "teal",
  valueTone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  accent?: Accent;
  valueTone?: "good" | "bad";
}) {
  const c = ACCENT_COLOR[accent];
  const valueColor = valueTone === "good" ? "var(--good)" : valueTone === "bad" ? "var(--bad)" : "var(--ink)";
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 shadow-soft transition hover:shadow-card">
      <div
        className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl"
        style={{ background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c }}
      >
        <Icon size={26} />
      </div>
      <div className="min-w-0">
        <div className="tnum font-display text-[26px] font-semibold leading-tight" style={{ color: valueColor }}>
          {value}
        </div>
        <div className="text-[13px] font-semibold text-muted">{label}</div>
        {sub && <div className="truncate text-[12px] text-muted">{sub}</div>}
      </div>
    </div>
  );
}

export function Pill({ type }: { type: TxType }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-bold capitalize", type === "income" ? "bg-good-bg text-good" : "bg-bad-bg text-bad")}>
      {type}
    </span>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="p-10 text-center text-muted">{children}</div>;
}

export function Spinner() {
  return (
    <div className="mx-auto my-16 h-9 w-9 animate-spin rounded-full border-[3px] border-line border-t-brand" />
  );
}
