import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2f6f4e",
          dark: "#245840",
          light: "#e8f1ec",
        },
      },
    },
  },
  plugins: [],
};

export default config;
