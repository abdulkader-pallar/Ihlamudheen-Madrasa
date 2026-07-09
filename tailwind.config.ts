import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic tokens — resolved from CSS variables so both themes work.
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        brand: { DEFAULT: "var(--brand)", 600: "var(--brand-600)" },
        accent: "var(--accent)",
        navy: "var(--navy)",
        good: "var(--good)",
        bad: "var(--bad)",
        "good-bg": "var(--good-bg)",
        "bad-bg": "var(--bad-bg)",
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
