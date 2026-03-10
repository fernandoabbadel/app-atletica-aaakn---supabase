import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",      // <--- TEM QUE TER O SRC
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}", // <--- TEM QUE TER O SRC
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",        // <--- TEM QUE TER O SRC
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          primary: "rgb(var(--tenant-primary-rgb) / <alpha-value>)",
          solid: "var(--tenant-primary)",
          accent: "var(--tenant-accent)",
        },
      },
    },
  },
  plugins: [],
};
export default config;
