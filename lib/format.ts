const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export const fmt = (n: number) => money.format(Number(n) || 0);

// Round to 2 decimals, absorbing binary-float drift (e.g. 0.1 + 0.2).
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const fmtDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export const monthKey = (d: string) => d.slice(0, 7);

export const monthLabel = (k: string) =>
  new Date(k + "-01T00:00:00").toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
