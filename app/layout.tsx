import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DOCK_INSET_BOOT_SCRIPT } from "@/lib/dockInset";
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
  appleWebApp: {
    capable: true,
    title: "TapAct",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/pwa-icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/pwa-icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa-icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/pwa-icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
        <script dangerouslySetInnerHTML={{ __html: DOCK_INSET_BOOT_SCRIPT }} />
        <ThemeSync />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
