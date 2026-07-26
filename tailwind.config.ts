import type { Config } from "tailwindcss";

const config: Config = {
  // Migrated components use Tailwind `dark:` variants (class-based). This app
  // themes via a `data-theme` attribute, so fire `dark:` on `[data-theme="dark"]`.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Ihlamudheen semantic tokens (unchanged) ──
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        brand: { DEFAULT: "var(--brand)", 600: "var(--brand-600)" },
        accent: "var(--accent)",
        good: "var(--good)",
        bad: "var(--bad)",
        "good-bg": "var(--good-bg)",
        "bad-bg": "var(--bad-bg)",
        // ── shadcn/base-ui tokens (added for migrated components) ──
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        "muted-foreground": "var(--muted-foreground)",
        "accent-foreground": "var(--accent-foreground)",
        destructive: "var(--destructive)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        // navy keeps `bg-navy` (DEFAULT) AND adds the `bg-navy-800` scale
        navy: {
          DEFAULT: "var(--navy)",
          50: "#e8edf4", 100: "#c5d0e3", 200: "#9fb2d0", 300: "#7994bd",
          400: "#5c7eaf", 500: "#3f68a1", 600: "#365993", 700: "#2c4a7e",
          800: "#1e3a5f", 900: "#0f2240", 950: "#081528",
        },
        gold: {
          50: "#fef8eb", 100: "#fdecc8", 200: "#fbdea2", 300: "#f9cf7a",
          400: "#f7c35c", 500: "#f5a623", 600: "#e6951a", 700: "#cc7f14",
          800: "#a3660f", 900: "#7a4c0b", 950: "#4a2e07",
        },
        "v0-gold": "var(--v0-gold)", "v0-gold-dim": "var(--v0-gold-dim)",
        "v0-emerald": "var(--v0-emerald)", "v0-emerald-dim": "var(--v0-emerald-dim)",
        "v0-teal": "var(--v0-teal)", "v0-teal-dim": "var(--v0-teal-dim)",
        "v0-blue": "var(--v0-blue)", "v0-blue-dim": "var(--v0-blue-dim)",
        "v0-rose": "var(--v0-rose)", "v0-rose-dim": "var(--v0-rose-dim)",
        "v0-amber": "var(--v0-amber)", "v0-amber-dim": "var(--v0-amber-dim)",
        "v0-purple": "var(--v0-purple)", "v0-purple-dim": "var(--v0-purple-dim)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        ar: ["Andalus", "var(--font-ar)", "serif"],
      },
      boxShadow: {
        card: "0 10px 30px -12px rgba(14,46,82,.18)",
        soft: "0 2px 8px -3px rgba(14,46,82,.16)",
        lift: "20px 40px 80px -40px rgba(14,46,82,.28)",
      },
      keyframes: {
        fade: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: { fade: "fade .3s ease" },
    },
  },
  plugins: [],
};

export default config;
