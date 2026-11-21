import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Office — Bangun produk digital bersama tim AI agent",
  description: "Konsultasi, analisis kebutuhan, dan development oleh tim AI agent yang bisa Anda pantau langsung.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
