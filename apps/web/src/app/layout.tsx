import type { Metadata } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { StepUpProvider } from "@/components/StepUpProvider";
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
  title: "Alnajoum Travel Agency",
  description: "Alnajoum Travel Agency Limited — Your Journey, Our Priority.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Every page is rendered per request, because each response carries its own Content-Security-Policy nonce
  // (src/proxy.ts); a page prerendered at build time could not have one and its scripts would be blocked.
  await connection();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <StepUpProvider>{children}</StepUpProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
