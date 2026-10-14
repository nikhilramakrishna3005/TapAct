import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { ServiceWorkerRegister } from "./components/ServiceWorkerRegister";
import { ThemeSync } from "./components/ThemeSync";
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
  title: "TapAct — Premium Activity Tracker",
  description:
    "TapAct helps you track everyday activities with one-tap start, pause, and automatic switching.",
};

export const viewport: Viewport = {
  themeColor: "#07070b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-motion="expressive" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeSync />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
