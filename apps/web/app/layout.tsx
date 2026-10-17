import type { Metadata } from "next";
import Link from "next/link";
import { GenithmBrand } from "@/components/genithm-brand";
import "./globals.css";
import "./genithm-light.css";

export const metadata: Metadata = {
  title: {default:"Genithm",template:"%s | Genithm"},
  description:"Your bioinformatics research workspace",
  icons:{icon:"/genithm-logo.webp",apple:"/genithm-logo.webp"},
};

export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
  return <html lang="en" data-genithm-theme="light">
    <body>
      <div className="container genithm-public-chrome">
        <nav className="nav" aria-label="Public navigation"><GenithmBrand href="/"/><div className="navlinks"><Link href="/legal/privacy">Privacy</Link><Link href="/legal/terms">Terms</Link><Link href="/signup">Create account</Link><Link className="button" href="/login">Sign in</Link></div></nav>
      </div>
      {children}
      <footer className="container footer genithm-public-chrome"><span>© Genithm</span><Link href="/legal/privacy">Privacy Policy</Link><Link href="/legal/terms">Terms of Service</Link></footer>
    </body>
  </html>;
}
