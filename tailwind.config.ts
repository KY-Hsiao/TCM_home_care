import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          ink: "#12343B",
          forest: "#29524A",
          moss: "#6B8A7A",
          sand: "#F4EFE5",
          coral: "#D76647"
        }
      },
      boxShadow: {
        card: "0 20px 45px -28px rgba(18, 52, 59, 0.35)"
      },
      fontFamily: {
        sans: ["Noto Sans TC", "Segoe UI", "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;
