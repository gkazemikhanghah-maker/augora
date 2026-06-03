/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f7f8f8",
        card: "#ffffff",
        ink: "#1c1d1f",
        muted: "#6b7077",
        line: "#e9eaec",
        "line-strong": "#d8dade",
        green: "#16a34a",
        "green-soft": "#e9f7ef",
        red: "#e0483a",
        "red-soft": "#fdeeec",
        amber: "#b9772a",
        blue: "#2f6aa6",
      },
      fontFamily: {
        // everything is Inter now (font-mono kept as an alias so existing classes restyle)
        sans: ["Inter", "system-ui", "sans-serif"],
        disp: ["Inter", "system-ui", "sans-serif"],
        mono: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(20,20,25,.04), 0 4px 12px -4px rgba(20,20,25,.06)",
        pop: "0 4px 24px -6px rgba(20,20,25,.12)",
      },
      maxWidth: {
        app: "1280px",
      },
    },
  },
  plugins: [],
};
