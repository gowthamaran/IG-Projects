import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Thoongatha Da",
  description: "an ai that doesn't let you sleep"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
