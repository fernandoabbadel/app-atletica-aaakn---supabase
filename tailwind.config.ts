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
      },
    },
  },
  plugins: [],
};
export default config;