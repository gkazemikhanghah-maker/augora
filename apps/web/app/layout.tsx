import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { Onboarding } from "@/components/Onboarding";

export const metadata = {
  title: "Augora — Prediction Market",
  description: "Fully-collateralized prediction market",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="sticky top-0 z-40 border-b border-line bg-card/90 backdrop-blur">
          <div className="mx-auto flex max-w-app items-center gap-6 px-6 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-green">
                <span className="h-[9px] w-[9px] rounded-[2px] bg-white" />
              </span>
              <span className="text-[18px] font-bold tracking-[-0.02em]">Augora</span>
              <span className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted" title="build marker">
                build 22 · true-write-framing
              </span>
            </Link>
            <nav className="hidden items-center gap-5 text-[13px] font-medium text-muted md:flex">
              <Link href="/" className="transition hover:text-ink">Markets</Link>
              <Link href="/live" className="flex items-center gap-1.5 transition hover:text-ink">
                Live<span className="h-1.5 w-1.5 rounded-full bg-green live-dot" />
              </Link>
              <Link href="/portfolio" className="transition hover:text-ink">Portfolio</Link>
            </nav>
            <div className="ml-auto flex items-center gap-4">
              <div className="hidden text-right sm:block">
                <div className="text-[10px] uppercase tracking-wide text-muted">Playground</div>
                <div className="text-[13px] font-semibold text-green">$10,000</div>
              </div>
              <Onboarding />
            </div>
          </div>
        </header>
        <main className="reveal mx-auto max-w-app px-6 pb-24">{children}</main>
      </body>
    </html>
  );
}
