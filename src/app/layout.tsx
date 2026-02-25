import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// 🦈 CONTEXTOS
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { CartProvider } from "@/context/CartContext";

// 🦈 COMPONENTES GLOBAIS
import BottomNav from "@/app/components/BottomNav";
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

// 1. METADATA (SEO & PWA)
export const metadata: Metadata = {
  title: "Tubarão App - AAAKN",
  description: "Portal oficial da Atlética Medicina Caraguá",
  manifest: "/manifest.json", // Link para o arquivo PWA
  icons: {
    icon: "/favicon.ico",
  },
};

// 2. VIEWPORT (Visual Mobile & Tema)
// Isso substitui o antigo 'theme-color' dentro do metadata
export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Impede zoom indesejado no app mobile
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-br" className="dark" data-scroll-behavior="smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#050505] text-white min-h-screen selection:bg-emerald-500/30`}
      >
        {/* 1. Autenticação */}
        <AuthProvider>
          
          {/* 2. Feedback Visual */}
          <ToastProvider>
            
            {/* 3. Carrinho */}
            <CartProvider>
              
              {/* 4. Proteção de Rotas */}
              <RouteGuard>
                
                {/* Conteúdo Principal */}
                <main className="pb-24 min-h-screen relative z-10">
                  {children}
                </main>

                {/* Navegação Fixa */}
                <BottomNav />

              </RouteGuard>
            </CartProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
