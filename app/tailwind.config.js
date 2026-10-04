/** @type {import('tailwindcss').Config} */
// Lokol design tokens. Two surfaces share one palette:
//  - "paper": warm editorial pages (Home, Recommend, Train, Eval, Deploy, Demo)
//  - "canvas": the dark lagoon-ink Studio canvas with luminous node cards
// ACTION colours are fixed: hibiscus = REFER_NOW, frangipani = REFER_NEXT_TRANSPORT,
// palm = offline / ADVISE-safe, slate = ASK_PERSON, reef = ADVISE / primary.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "!./src/runtime/**"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#102C3C", 2: "#2B4A5A", 3: "#5C7482", 4: "#8A9EA8" },
        "ink-2": "#2B4A5A",
        "ink-3": "#5C7482",
        "ink-4": "#8A9EA8",
        reef: { DEFAULT: "#0F7B88", deep: "#0B5E68", bright: "#2EC4D3", tint: "#D7ECEE", pale: "#EDF6F6" },
        paper: { DEFAULT: "#EEF4F2", 2: "#E4EDEA", warm: "#F6F2E9" },
        card: "#FFFFFF",
        line: { DEFAULT: "#D9D3C6", 2: "#E8E3D8", cool: "#CFDCD9" },
        "line-2": "#E8E3D8",
        sand: { DEFAULT: "#F7F3EA", deep: "#EDE5D4" },
        hibiscus: { DEFAULT: "#C32F49", deep: "#9E2239", bright: "#F2647E", tint: "#F8E1E5" },
        frangipani: { DEFAULT: "#E9A93A", deep: "#8A5A08", bright: "#F2B84B", tint: "#FBEFD6" },
        palm: { DEFAULT: "#3C8A4F", deep: "#2A6A3A", bright: "#5CC48A", tint: "#E1F0E4" },
        slate: { DEFAULT: "#5C6B75", deep: "#3F4C55", tint: "#E6EAED" },
        // Studio canvas (dark lagoon)
        canvas: {
          DEFAULT: "#0B1F2A",
          2: "#10293A",
          3: "#163447",
          4: "#1E4258",
          line: "#24465A",
          dot: "#1F3D50",
          text: "#DCE8EB",
          muted: "#8DA7B2",
          faint: "#5D7C8A"
        },
        // Per node type: luminous accents for the dark canvas (stripes, edges, glows)
        glow: {
          channel: "#7FB3C8",
          stt: "#5CC48A",
          rag: "#F2B84B",
          llm: "#2EC4D3",
          gate: "#F2647E",
          tts: "#B394F0",
          router: "#A3B4BE",
          note: "#D6B07A"
        }
      },
      fontFamily: {
        display: ["'Bricolage Grotesque'", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["'Instrument Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "14px" }],
        // Display scale (Bricolage). Use with font-display.
        "d-xl": ["clamp(44px, 7.4vw, 92px)", { lineHeight: "0.94", letterSpacing: "-0.035em" }],
        "d-lg": ["clamp(34px, 4.6vw, 56px)", { lineHeight: "1.0", letterSpacing: "-0.03em" }],
        "d-md": ["clamp(28px, 3.2vw, 40px)", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "d-sm": ["24px", { lineHeight: "1.15", letterSpacing: "-0.015em" }],
        "d-xs": ["19px", { lineHeight: "1.2", letterSpacing: "-0.01em" }]
      },
      boxShadow: {
        card: "0 1px 0 rgba(16,44,60,0.06), 0 8px 24px -12px rgba(16,44,60,0.18)",
        lift: "0 1px 0 rgba(16,44,60,0.06), 0 18px 40px -18px rgba(16,44,60,0.32)",
        node: "0 1px 0 rgba(16,44,60,0.08), 0 10px 28px -14px rgba(16,44,60,0.35)",
        "node-dark": "0 0 0 1px rgba(255,255,255,0.06), 0 18px 40px -16px rgba(0,0,0,0.65)",
        inset: "inset 0 0 0 1px rgba(16,44,60,0.08)",
        focus: "0 0 0 3px rgba(15,123,136,0.28)"
      },
      borderRadius: { xl2: "1.25rem", "4xl": "2rem" },
      keyframes: {
        "toast-in": { from: { opacity: "0", transform: "translateY(8px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "progress-indeterminate": { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(250%)" } },
        pulse2: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } }
      },
      animation: {
        "toast-in": "toast-in 180ms cubic-bezier(.2,.8,.2,1)",
        "fade-in": "fade-in 160ms ease-out",
        "progress-indeterminate": "progress-indeterminate 1.3s ease-in-out infinite",
        pulse2: "pulse2 1.6s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
