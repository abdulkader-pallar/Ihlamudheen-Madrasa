"use client";

import { useEffect } from "react";
import { cx } from "@/lib/ui";
import type { TxType } from "@/lib/types";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-5 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-card">
        <h3 className="mb-4 font-display text-xl font-semibold">{title}</h3>
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

export function StatCard({ label, value, tone, dot }: { label: string; value: string; tone?: "income" | "expense" | "brand"; dot?: "i" | "e" | "b" }) {
  const color = tone === "income" ? "text-good" : tone === "expense" ? "text-bad" : "text-ink";
  const dotColor = dot === "i" ? "bg-good" : dot === "e" ? "bg-bad" : "bg-brand";
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
      <div className="flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.06em] text-muted">
        {dot && <span className={cx("h-2.5 w-2.5 rounded-full", dotColor)} />}
        {label}
      </div>
      <div className={cx("tnum mt-2 font-display text-3xl font-semibold", color)}>{value}</div>
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
