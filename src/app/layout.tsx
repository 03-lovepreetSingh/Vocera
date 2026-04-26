import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vocera — the phone line, rebuilt for AI',
  description: 'Build voice and chat AI agents grounded in your knowledge base.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
