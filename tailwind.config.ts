import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d1d1f",
        graphite: "#424245",
        silver: {
          50: "#fbfbfd",
          100: "#f5f5f7",
          200: "#e8e8ed",
          300: "#d2d2d7",
          400: "#bfbfc4",
          500: "#86868b",
        },
        // 포인트 컬러 (하늘색) - 선택/활성 상태, 링크, 포커스 등 강조가 필요한 곳에만 사용
        accent: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "SF Pro Text",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
