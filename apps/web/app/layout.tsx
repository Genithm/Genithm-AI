import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Genithm AI",
  description: "Evidence-backed AI bioinformatics research workspace",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <nav className="nav">
            <Link className="brand" href="/">GENITHM AI</Link>
            <div className="navlinks">
              <Link href="/legal/privacy">Privacy</Link>
              <Link href="/legal/terms">Terms</Link>
              <Link className="button" href="/login">Sign in</Link>
            </div>
          </nav>
        </div>
        {children}
        <div className="container footer">
          <span>© Genithm AI</span>
          <Link href="/legal/privacy">Privacy Policy</Link>
          <Link href="/legal/terms">Terms of Service</Link>
          <span>Security & Trust Center: coming soon</span>
        </div>
      </body>
    </html>
  );
}
