import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Adaptive Triage — prototype",
  description:
    "Prototype demonstration of continuously re-scored emergency department triage. Synthetic data only. Not a medical device.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans text-body">{children}</body>
    </html>
  );
}
