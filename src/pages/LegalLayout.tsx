// Shared shell for the public legal pages (Privacy, Terms, Data Deletion).
// Owns the scoped styles so the bare element selectors (body/h1/h2/a/…) from the
// source HTML don't leak into the rest of the app. Each page renders its own
// <header>/content as children inside `.wrap`.

import type { ReactNode } from 'react';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bk-legal">
      <style>{`
        .bk-legal {
          --ink: #2b2722;
          --muted: #6b645b;
          --line: #e7e1d8;
          --bg: #fbf9f6;
          --accent: #9a5b3b;
          min-height: 100vh;
          background: var(--bg);
          color: var(--ink);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          line-height: 1.65;
          -webkit-font-smoothing: antialiased;
        }
        .bk-legal * { box-sizing: border-box; }
        .bk-legal .wrap { max-width: 720px; margin: 0 auto; padding: 64px 24px 96px; }
        .bk-legal header { border-bottom: 1px solid var(--line); padding-bottom: 24px; margin-bottom: 40px; }
        .bk-legal h1 { font-size: 30px; margin: 0 0 8px; letter-spacing: -0.01em; }
        .bk-legal .meta { color: var(--muted); font-size: 14px; }
        .bk-legal h2 { font-size: 19px; margin: 40px 0 12px; letter-spacing: -0.01em; }
        .bk-legal p, .bk-legal li { color: var(--ink); font-size: 16px; }
        .bk-legal a { color: var(--accent); }
        .bk-legal ul, .bk-legal ol { padding-left: 20px; }
        .bk-legal li { margin-bottom: 6px; }
        .bk-legal .note {
          background: #fff; border: 1px solid var(--line); border-radius: 10px;
          padding: 16px 20px; margin-top: 28px; color: var(--muted); font-size: 14px;
        }
        .bk-legal footer {
          margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--line);
          color: var(--muted); font-size: 14px;
        }
      `}</style>
      <div className="wrap">{children}</div>
    </div>
  );
}
