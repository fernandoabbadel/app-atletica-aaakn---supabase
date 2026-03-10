"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  ShieldAlert,
  Lock,
  LogOut,
  MessageCircle,
  AlertTriangle,
} from "lucide-react";
import { signOut } from "@/lib/supa/auth";
import { auth } from "@/lib/backend";
import { useRouter } from "next/navigation";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { buildLoginPath } from "@/lib/authRedirect";

export default function BannedPage() {
  const router = useRouter();
  const { tenantLogoUrl, tenantName, tenantSigla } = useTenantTheme();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
      router.push(buildLoginPath("/banned"));
    } catch (error: unknown) {
      console.error("Erro ao sair:", error);
      setLoading(false);
    }
  };

  const handleContact = () => {
    window.open(
      "https://wa.me/5512999999999?text=Ol%C3%A1%2C%20minha%20conta%20no%20App%20est%C3%A1%20bloqueada.",
      "_blank"
    );
  };

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-6 text-center font-sans relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-red-900/20 via-black to-black z-0"></div>

      <div className="relative z-10 max-w-md w-full space-y-8">
        <div className="relative mx-auto w-32 h-32 flex items-center justify-center">
          <div className="absolute inset-0 bg-red-600/20 rounded-full animate-ping"></div>
          <div className="relative bg-zinc-900 border-4 border-red-600 rounded-full p-6 shadow-[0_0_40px_rgba(220,38,38,0.5)]">
            <Lock size={48} className="text-red-500" />
          </div>
          <div className="absolute -top-2 -right-2 bg-yellow-500 text-black p-2 rounded-full border-4 border-[#050505]">
            <ShieldAlert size={20} />
          </div>
        </div>

        <div className="mx-auto w-20 h-20 rounded-xl bg-black/60 border border-zinc-700 relative overflow-hidden">
          <Image
            src={tenantLogoUrl || "/logo.png"}
            alt={`Logo ${tenantName || "Tenant"}`}
            fill
            sizes="80px"
            className="object-contain p-2"
          />
        </div>

        <div className="space-y-4">
          <h1 className="text-4xl font-black uppercase italic tracking-tighter text-white">
            Acesso <span className="text-red-600">Negado</span>
          </h1>
          <p className="text-zinc-400 text-sm font-medium leading-relaxed bg-zinc-900/50 p-4 rounded-xl border border-red-900/30">
            <span className="text-white font-bold block mb-2 text-xs uppercase tracking-widest flex items-center justify-center gap-2">
              <AlertTriangle size={12} className="text-red-500" /> Conta bloqueada
            </span>
            Sua conta foi suspensa ou bloqueada pela diretoria de {tenantName || "sua atlética"}. Isso pode ocorrer por pendencias financeiras ou violacao de regras.
          </p>
        </div>

        <div className="space-y-3 pt-4">
          <button
            onClick={handleContact}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-emerald-900/20 group"
          >
            <MessageCircle size={20} className="group-hover:scale-110 transition-transform" />
            Falar com a Diretoria
          </button>

          <button
            onClick={handleLogout}
            disabled={loading}
            className="w-full bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white font-bold uppercase py-4 rounded-xl flex items-center justify-center gap-2 transition-all border border-zinc-800"
          >
            {loading ? (
              <span className="animate-pulse">Saindo...</span>
            ) : (
              <>
                <LogOut size={20} />
                Sair da Conta
              </>
            )}
          </button>
        </div>

        <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest pt-8">
          Sistema de Seguranca {tenantSigla || "USC"}
        </p>
      </div>
    </div>
  );
}
