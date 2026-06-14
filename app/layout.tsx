import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { AppToaster } from "@/components/app-toaster";
import { ToastFromSearchParams } from "@/components/toast-from-search-params";
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
  title: "Elyx Resource Allocator",
  description: "Personalized healthspan scheduling across clients, staff, and equipment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Suspense fallback={null}>
          <ToastFromSearchParams />
        </Suspense>
        <AppToaster />
      </body>
    </html>
  );
}
