import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { isAuthConfigured } from "@/lib/auth-config";
import "./globals.css";

export const metadata: Metadata = {
  title: "MovieWatch AI — Never miss a premiere again",
  description:
    "Set your movie preferences now. Our AI watches for ticket releases and books automatically when they go live.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const body = (
    <html lang="en">
      <body className="cinema-glow min-h-screen">{children}</body>
    </html>
  );
  if (!isAuthConfigured) return body;
  return <ClerkProvider>{body}</ClerkProvider>;
}
