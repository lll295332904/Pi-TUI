/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        sidebar: { DEFAULT: "#f8f8f8", hover: "#ececec", active: "#e0e0e0" },
        surface: { DEFAULT: "#ffffff", secondary: "#f5f5f5" },
        border: { DEFAULT: "#e5e5e5", focus: "#4f8cff" },
        accent: { DEFAULT: "#4f8cff", hover: "#3a7bef" },
        danger: { DEFAULT: "#e53e3e", hover: "#c53030" },
        success: { DEFAULT: "#38a169", hover: "#2f855a" },
        warning: { DEFAULT: "#d69e2e", hover: "#b7791f" },
        muted: { DEFAULT: "#888888", fg: "#555555" },
        inline: {
          code: "#f0f0f0",
          "code-fg": "#333333",
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', "system-ui", "sans-serif"],
        mono: ['"Cascadia Code"', '"JetBrains Mono"', "Consolas", "monospace"],
      },
      fontSize: {
        xs: ["0.75rem", "1rem"],
        sm: ["0.8125rem", "1.25rem"],
        base: ["0.875rem", "1.5rem"],
      },
    },
  },
  plugins: [],
};
