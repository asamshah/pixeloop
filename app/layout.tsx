import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ads Agent",
  description: "AI audits for Google Ads and Meta Ads",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="mx-auto flex w-full max-w-4xl items-center gap-6 px-4 pt-6 text-sm">
          <Link href="/" className="font-semibold">Ads Agent</Link>
          <Link href="/" className="text-neutral-500 hover:text-foreground">Dashboard</Link>
          <Link href="/connect" className="text-neutral-500 hover:text-foreground">Connections</Link>
          <Link href="/settings" className="text-neutral-500 hover:text-foreground">Thresholds</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
