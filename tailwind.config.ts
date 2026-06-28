import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"DM Serif Display"', "serif"],
        body: ['"DM Sans"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        surface: {
          50:  "#e8f6f5",
          100: "#c2e8e5",
          200: "#80cfc9",
          300: "#a0c4c8",
          800: "#004d5a",
          900: "#003641",
          950: "#002530",
        },
        accent: {
          DEFAULT: "#00AE9D",
          light:   "#33c4b5",
          dark:    "#008070",
          glow:    "#00AE9D33",
        },
        success: "#7DB61C",
        danger:  "#c44a4a",
        info:    "#49479D",
        lime:    "#C9D200",
      },
      animation: {
        "fade-in":    "fadeIn 0.5s ease-out forwards",
        "slide-up":   "slideUp 0.5s ease-out forwards",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.7" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
