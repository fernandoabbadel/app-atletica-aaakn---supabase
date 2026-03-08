import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { CartProvider } from "@/context/CartContext";
import { TenantThemeProvider } from "@/context/TenantThemeContext";

import BottomNav from "@/app/components/BottomNav";
import MasterTopBar from "@/app/components/MasterTopBar";
import RouteGuard from "@/app/components/RouteGuard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "USC - Universidade Spot Connect",
  description: "Plataforma oficial multi-atleticas",
  manifest: "/manifest.json",
  icons: {
    icon: ["/favicon.ico", "/favicon-32x32.png", "/favicon-16x16.png"],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-br" className="dark" data-scroll-behavior="smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-[#050505] text-white antialiased`}
      >
        <AuthProvider>
          <TenantThemeProvider>
            <ToastProvider>
              <CartProvider>
                <RouteGuard>
                  <MasterTopBar />
                  <main className="relative z-10 min-h-screen pb-24">
                    {children}
                  </main>
                  <BottomNav />
                </RouteGuard>
              </CartProvider>
            </ToastProvider>
          </TenantThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
