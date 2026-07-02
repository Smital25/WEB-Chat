import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1a1a1a",
        paper: "#fbfbfa",
        highlight: "#f5b301",     // "highlighter" accent for anything web-sourced
        "highlight-soft": "#fef3c7",
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'serif'],
      },
    },
  },
  plugins: [],
};
export default config;
