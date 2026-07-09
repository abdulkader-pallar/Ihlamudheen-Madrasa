"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

function currentIsDark() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(false);

  useEffect(() => setDark(currentIsDark()), []);

  const toggle = () => {
    const next = currentIsDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
    setDark(next === "dark");
    window.dispatchEvent(new Event("themechange"));
  };

  return (
    <button
      onClick={toggle}
      aria-label="Toggle light or dark theme"
      className={
        "grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-ink transition hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent " +
        className
      }
    >
      {dark ? <Moon size={19} /> : <Sun size={19} />}
    </button>
  );
}
