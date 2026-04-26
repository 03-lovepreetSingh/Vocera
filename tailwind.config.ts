import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // PRD §5.3 design tokens, mapped to CSS variables defined in globals.css
        paper: 'var(--paper)',
        fill: 'var(--fill)',
        ink: { DEFAULT: 'var(--ink)', 3: 'var(--ink-3)' },
        accent: { DEFAULT: 'var(--accent)', soft: 'var(--accent-soft)' },
        line: { soft: 'var(--line-soft)' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { lg: '12px', md: '8px', sm: '6px' },
    },
  },
  plugins: [animate],
};

export default config;
