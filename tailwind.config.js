/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      screens: {
        xs: "375px",
      },
      colors: {
        // Stitch Design System — Material You tokens
        "primary": "#000000",
        "on-primary": "#ffffff",
        "primary-container": "#131b2e",
        "on-primary-container": "#7c839b",
        "primary-fixed": "#dae2fd",
        "primary-fixed-dim": "#bec6e0",
        "on-primary-fixed": "#131b2e",
        "on-primary-fixed-variant": "#3f465c",
        "inverse-primary": "#bec6e0",

        "secondary": "#006c49",
        "on-secondary": "#ffffff",
        "secondary-container": "#6cf8bb",
        "on-secondary-container": "#00714d",
        "secondary-fixed": "#6ffbbe",
        "secondary-fixed-dim": "#4edea3",
        "on-secondary-fixed": "#002113",
        "on-secondary-fixed-variant": "#005236",

        "tertiary": "#000000",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#2a1700",
        "on-tertiary-container": "#b87500",
        "tertiary-fixed": "#ffddb8",
        "tertiary-fixed-dim": "#ffb95f",
        "on-tertiary-fixed": "#2a1700",
        "on-tertiary-fixed-variant": "#653e00",

        "error": "#ba1a1a",
        "on-error": "#ffffff",
        "error-container": "#ffdad6",
        "on-error-container": "#93000a",

        "background": "#f8f9ff",
        "on-background": "#0b1c30",
        "surface": "#f8f9ff",
        "on-surface": "#0b1c30",
        "surface-variant": "#d3e4fe",
        "on-surface-variant": "#45464d",
        "surface-bright": "#f8f9ff",
        "surface-dim": "#cbdbf5",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#eff4ff",
        "surface-container": "#e5eeff",
        "surface-container-high": "#dce9ff",
        "surface-container-highest": "#d3e4fe",

        "outline": "#76777d",
        "outline-variant": "#c6c6cd",
        "inverse-surface": "#213145",
        "inverse-on-surface": "#eaf1ff",
        "surface-tint": "#565e74",
        "terracotta": "#C45B39",
        "terracotta-tint": "rgba(196,91,57,0.05)",
      },
      spacing: {
        "stack-sm": "4px",
        "base": "8px",
        "stack-md": "12px",
        "gutter": "16px",
        "stack-lg": "24px",
        "margin-mobile": "16px",
        "margin-desktop": "32px",
        // Touch-friendly targets (WCAG)
        "touch": "48px",
        "touch-lg": "56px",
        // Safe-area-inset shortcuts (mobile / notched phones)
        "safe-t": "env(safe-area-inset-top)",
        "safe-b": "env(safe-area-inset-bottom)",
        "safe-l": "env(safe-area-inset-left)",
        "safe-r": "env(safe-area-inset-right)",
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
      fontFamily: {
        "headline-lg": ["Manrope", "sans-serif"],
        "headline-lg-mobile": ["Manrope", "sans-serif"],
        "headline-md": ["Manrope", "sans-serif"],
        "body-lg": ["Inter", "sans-serif"],
        "body-sm": ["Inter", "sans-serif"],
        "label-caps": ["Inter", "sans-serif"],
        "data-mono": ["Geist", "monospace"],
      },
      fontSize: {
        "headline-lg": ["30px", { lineHeight: "38px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg-mobile": ["24px", { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "700" }],
        "headline-md": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "body-lg": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-sm": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-caps": ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "600" }],
        "data-mono": ["14px", { lineHeight: "20px", fontWeight: "500" }],
        // Mobile type scale (Part 7)
        "mobile-xs":   ["11px", { lineHeight: "16px" }],
        "mobile-sm":   ["13px", { lineHeight: "20px" }],
        "mobile-base": ["15px", { lineHeight: "24px" }],
        "mobile-lg":   ["17px", { lineHeight: "26px" }],
        "mobile-xl":   ["20px", { lineHeight: "28px" }],
        "mobile-2xl":  ["24px", { lineHeight: "32px" }],
      },
      boxShadow: {
        // Legacy
        "card":       "0px 2px 4px rgba(11, 28, 48, 0.04)",
        "card-md":    "0px 4px 8px rgba(11, 28, 48, 0.08)",
        "card-lg":    "0px 8px 24px rgba(11, 28, 48, 0.10)",
        // Material elevation scale
        "elevation-1":  "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
        "elevation-2":  "0 2px 8px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)",
        "elevation-6":  "0 6px 16px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.08)",
        "elevation-8":  "0 8px 24px rgba(0,0,0,0.12), 0 3px 8px rgba(0,0,0,0.06)",
        "elevation-16": "0 16px 40px rgba(0,0,0,0.16), 0 6px 16px rgba(0,0,0,0.08)",
        "snackbar":     "0 8px 24px rgba(0,0,0,0.20), 0 3px 8px rgba(0,0,0,0.12)",
      },
      keyframes: {
        "snackbar-in": {
          "0%":   { transform: "translateX(-50%) translateY(20px)", opacity: "0" },
          "100%": { transform: "translateX(-50%) translateY(0)",    opacity: "1" },
        },
        "snackbar-out": {
          "0%":   { transform: "translateX(-50%) translateY(0)",    opacity: "1" },
          "100%": { transform: "translateX(-50%) translateY(16px)", opacity: "0" },
        },
        "fab-enter": {
          "0%":   { transform: "scale(0.8)", opacity: "0" },
          "100%": { transform: "scale(1)",   opacity: "1" },
        },
        "linear-progress": {
          "0%":   { transform: "translateX(-150%) scaleX(0.6)" },
          "50%":  { transform: "translateX(0%)    scaleX(0.8)" },
          "100%": { transform: "translateX(150%)  scaleX(0.6)" },
        },
        "ripple-expand": {
          "0%":   { transform: "translate(-50%,-50%) scale(0)", opacity: "0.14" },
          "70%":  { transform: "translate(-50%,-50%) scale(2)", opacity: "0.07" },
          "100%": { transform: "translate(-50%,-50%) scale(3)", opacity: "0"    },
        },
        "peek-in": {
          "0%":   { transform: "translateY(24px) scale(0.97)", opacity: "0" },
          "100%": { transform: "translateY(0)    scale(1)",    opacity: "1" },
        },
        "glass-breathe": {
          "0%, 100%": { backgroundColor: "rgba(255,255,255,0.80)" },
          "50%":       { backgroundColor: "rgba(255,255,255,0.92)" },
        },
        "explanation-lifecycle": {
          "0%, 3.5%": { opacity: "0", transform: "translateY(4px)" },
          "7%, 94%":  { opacity: "1", transform: "translateY(0)" },
          "100%":     { opacity: "0", transform: "translateY(0)" },
        },
        // Mobile motion primitives (Part 1.1 / Part 6)
        "slide-up": {
          "0%":   { transform: "translateY(8px)",  opacity: "0" },
          "100%": { transform: "translateY(0)",    opacity: "1" },
        },
        "slide-down": {
          "0%":   { transform: "translateY(-8px)", opacity: "0" },
          "100%": { transform: "translateY(0)",    opacity: "1" },
        },
        "fade-in": {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%":   { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)",    opacity: "1" },
        },
        "sheet-up": {
          "0%":   { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)"    },
        },
      },
      animation: {
        "snackbar-in":  "snackbar-in  0.22s cubic-bezier(0.0,0,0.2,1) forwards",
        "snackbar-out": "snackbar-out 0.18s cubic-bezier(0.4,0,1,1) forwards",
        "fab-enter":    "fab-enter    0.28s cubic-bezier(0.0,0,0.2,1) both",
        "linear-progress": "linear-progress 1.5s infinite cubic-bezier(0.4,0,0.2,1)",
        "peek-in":          "peek-in          0.22s cubic-bezier(0.0,0,0.2,1) both",
        "glass-breathe":    "glass-breathe    2.5s ease-in-out infinite",
        "explanation-lifecycle": "explanation-lifecycle 8.6s linear forwards",
        // Mobile motion primitives
        "slide-up":   "slide-up   0.3s  cubic-bezier(0.16,1,0.3,1) both",
        "slide-down": "slide-down 0.3s  cubic-bezier(0.16,1,0.3,1) both",
        "fade-in":    "fade-in    0.2s  ease-out both",
        "scale-in":   "scale-in   0.2s  cubic-bezier(0.16,1,0.3,1) both",
        "sheet-up":   "sheet-up   0.35s cubic-bezier(0.32,0.72,0,1) both",
      },
      transitionTimingFunction: {
        "material":       "cubic-bezier(0.4,0,0.2,1)",
        "material-enter": "cubic-bezier(0.0,0,0.2,1)",
        "material-exit":  "cubic-bezier(0.4,0,1,1)",
      },
      transitionDuration: {
        "150": "150ms",
        "200": "200ms",
        "250": "250ms",
        "300": "300ms",
      },
    },
  },
  plugins: [],
}
