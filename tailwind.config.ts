import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Theme switching is handled via `<html data-theme="light|dark">` and CSS
 * variables in globals.css — Tailwind's class-based dark mode is disabled.
 * Tokens below proxy to those CSS variables so utilities stay theme-aware.
 */
const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        paper: 'var(--paper)',
        fill: { DEFAULT: 'var(--fill)', 2: 'var(--fill-2)' },
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          2: 'var(--accent-2)',
          soft: 'var(--accent-soft)',
        },
        line: {
          DEFAULT: 'var(--line)',
          soft: 'var(--line-soft)',
          softer: 'var(--line-softer)',
        },
        warn: 'var(--warn)',
        ok: 'var(--ok)',
        err: 'var(--err)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { lg: '14px', md: '10px', sm: '6px' },
      boxShadow: {
        token: 'var(--shadow)',
        'token-sm': 'var(--shadow-sm)',
      },
    },
  },
  plugins: [animate],
};

export default config;
