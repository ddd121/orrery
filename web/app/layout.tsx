import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORRERY — influence, mapped",
  description:
    "Sourced connections between UK public figures and the money and companies around them, with an honest confidence score on every link. Facts, not verdicts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
