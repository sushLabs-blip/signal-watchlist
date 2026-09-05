import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal — Smart Market Watchlist",
  description: "See what changed in your market watchlist.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}