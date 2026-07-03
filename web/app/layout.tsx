import type { Metadata } from "next";
import { Newsreader, Public_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

/* "The Register" type system: a broadsheet serif used sparingly for display, a civic gothic
   for body/UI, and a UI mono for every audited figure. Self-hosted via next/font. */
const display = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["500", "600"],
  variable: "--font-display",
  display: "swap",
});
const sans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ORRERY",
  description:
    "A public-record map of UK political influence. Every connection between public figures, companies and political money is drawn from a public register, and carries its source and an honest confidence score. Facts, not verdicts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
