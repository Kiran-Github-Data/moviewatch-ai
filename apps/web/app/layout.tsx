import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { isAuthConfigured } from "@/lib/auth-config";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MovieWatch AI — Never miss a premiere again",
  description:
    "Set your movie preferences now. Our AI watches for ticket releases and books automatically when they go live.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const bodyEl = (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="cinema-glow min-h-screen">{children}</body>
    </html>
  );
  if (!isAuthConfigured) return bodyEl;
  return <ClerkProvider>{bodyEl}</ClerkProvider>;
}
