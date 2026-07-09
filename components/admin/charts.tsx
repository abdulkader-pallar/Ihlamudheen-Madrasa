"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmt } from "@/lib/format";

function useThemeColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const g = (k: string) => s.getPropertyValue(k).trim();
    return { good: g("--good"), bad: g("--bad"), line: g("--line"), muted: g("--muted") };
  };
  const [c, setC] = useState({ good: "#12805c", bad: "#c0392b", line: "#e2e9f0", muted: "#55677a" });
  useEffect(() => {
    setC(read());
    const h = () => setC(read());
    window.addEventListener("themechange", h);
    return () => window.removeEventListener("themechange", h);
  }, []);
  return c;
}

const kFmt = (v: number) => "₹" + (v >= 1000 ? v / 1000 + "k" : v);

export function MonthlyChart({ data }: { data: { label: string; income: number; expense: number }[] }) {
  const c = useThemeColors();
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 6, left: 6, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={c.line} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: c.muted, fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: c.muted, fontSize: 11 }} tickFormatter={kFmt} />
        <Tooltip
          cursor={{ fill: c.line, opacity: 0.3 }}
          formatter={(v: number | string) => fmt(Number(v))}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--ink)" }}
        />
        <Legend wrapperStyle={{ fontSize: 13 }} />
        <Bar dataKey="income" name="Income" fill={c.good} radius={[5, 5, 0, 0]} />
        <Bar dataKey="expense" name="Expense" fill={c.bad} radius={[5, 5, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const PALETTE = ["#16807F", "#F0A82C", "#0E2E52", "#c0392b", "#8e44ad", "#2e86c1", "#27ae60", "#e67e22"];

export function CategoryDonut({ data }: { data: { name: string; value: number }[] }) {
  const c = useThemeColors();
  if (!data.length) return <div className="grid h-[280px] place-items-center text-muted">No expenses recorded.</div>;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={100} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="transparent" />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number | string) => fmt(Number(v))}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--ink)" }}
        />
        <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11, color: c.muted }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
