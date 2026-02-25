"use client";

import React, { useState } from "react";
import {
  ArrowLeft, Bell, LogOut, ChevronRight,
  FileText, Smartphone,
  Trash2, Power, PowerOff, AlertTriangle, Loader2,
  Crown, Shield, History
} from "lucide-react";
import Link from "next/link";
import Image from "next/image"; // 🦈 Importado para otimização
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { auth } from "@/lib/backend";
import { deleteUser } from "@/lib/supa/auth";
import { logActivity } from "../../lib/logger";
import { softDeleteAccount, toggleAccountStatus } from "../../lib/settingsService";

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  
  const [actionLoading, setActionLoading] = useState(false);
  const [notificacoes, setNotificacoes] = useState(true);

  // --- AÇÃO 1: DESATIVAR / REATIVAR (Pausar) ---
  const handleToggleAccount = async () => {
    if (!user) return;
    const isActive = user.status === 'ativo';
    
    const confirmMsg = isActive 
        ? "⏸️ PAUSAR CONTA?\n\nVocê ficará como 'Inativo'. Seus dados e XP serão mantidos, mas você perderá acesso às áreas exclusivas até reativar."
        : "▶️ REATIVAR CONTA?\n\nSeus privilégios originais serão restaurados imediatamente.";

    if (!window.confirm(confirmMsg)) return;

    try {
        setActionLoading(true);
        const statusResult = await toggleAccountStatus({
            uid: user.uid,
            currentStatus: user.status,
            currentRole: typeof user.role === "string" ? user.role : "user",
            savedRole: typeof user.saved_role === "string" ? user.saved_role : null,
        });

        if (statusResult.nextStatus === "paused") {
            await logActivity(user.uid, user.nome, "UPDATE", "Configuracoes", "Pausou a conta (Virou Inactive)");
            addToast("Conta pausada. Acesso restrito.", "info");
        } else {
            await logActivity(user.uid, user.nome, "UPDATE", "Configuracoes", "Reativou a conta");
            addToast("Conta reativada! Bem-vindo de volta.", "success");
        }
    } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao atualizar status da conta.", "error");
    } finally {
        setActionLoading(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm("Sair do aplicativo?")) {
      await logout();
      router.push("/login");
    }
  };

  const handleDeleteAccount = async () => {
    const confirmText = prompt("🚨 ATENÇÃO: EXCLUSÃO DEFINITIVA\n\nEssa ação é irreversível. Seus dados pessoais serão apagados para sempre.\n\nPara confirmar, digite DELETAR:");
    if (confirmText !== "DELETAR") return addToast("Ação cancelada.", "info");
    if (!user || !auth.currentUser) return;

    try {
        setActionLoading(true);
        await softDeleteAccount({
            uid: user.uid,
            photoUrl: typeof user.foto === "string" ? user.foto : undefined,
        });
        await logActivity(user.uid, "Ex-Usuário", "DELETE", "Conta", "Excluiu a própria conta (Soft Delete)");
        try { await deleteUser(auth.currentUser); } catch (authError) { console.warn("Erro ao deletar do Auth:", authError); }
        addToast("Sua conta foi excluída. Até logo! 👋", "info");
        router.push("/login");
    } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao processar exclusao.", "error");
    } finally {
        setActionLoading(false);
    }
  };

  if (!user) return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500"/></div>;

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-24 font-sans selection:bg-emerald-500">
      
      {/* HEADER */}
      <header className="p-4 sticky top-0 z-30 flex items-center gap-4 border-b border-white/5 bg-[#050505]/90 backdrop-blur-md">
        <Link href="/dashboard" className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full transition hover:bg-zinc-900">
            <ArrowLeft size={24} />
        </Link>
        <h1 className="font-black text-xl italic uppercase tracking-tighter text-white">Central do Sócio</h1>
      </header>

      <main className="p-4 space-y-6 animate-in slide-in-from-bottom-4 duration-500">
        
        {/* 1. CARTÃO DE PERFIL + PLANO (Vindo do antigo Menu) */}
        <section className="relative overflow-hidden bg-gradient-to-br from-zinc-900 to-black border border-zinc-800 rounded-[2rem] p-5">
            <div className="flex items-center gap-4 relative z-10">
                <div className="relative">
                    <div className="w-20 h-20 rounded-full p-1 bg-gradient-to-tr from-emerald-500 to-emerald-900 relative">
                        <Image 
                            src={user.foto || "https://github.com/shadcn.png"} 
                            alt="Perfil" 
                            fill
                            className="object-cover rounded-full border-4 border-[#050505]"
                            unoptimized
                        />
                    </div>
                    <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-black p-1.5 rounded-full border-4 border-[#050505] z-10">
                        <Crown size={12} strokeWidth={3} />
                    </div>
                </div>

                <div className="flex-1">
                    <h2 className="font-black text-xl text-white leading-none mb-1">{user.nome}</h2>
                    <p className="text-xs text-zinc-400 font-medium mb-3">{user.role === 'user' ? 'Membro' : user.role} • {user.turma || "T??"}</p>
                    
                    <div className="flex items-center gap-2 mb-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider flex items-center gap-1 ${user.plano_cor ? `text-${user.plano_cor}-400 bg-${user.plano_cor}-500/10 border-${user.plano_cor}-500/20` : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>
                            <Crown size={10} strokeWidth={3} /> {user.plano || "Bicho Solto"}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${user.status === 'ativo' ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 'text-red-500 bg-red-500/10 border-red-500/20'}`}>
                            {user.status}
                        </span>
                    </div>

                    <Link href="/carteirinha" className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 transition px-3 py-1.5 rounded-lg border border-white/10 group">
                        <Smartphone size={14} className="text-emerald-500" />
                        <span className="text-[10px] font-bold text-zinc-300 group-hover:text-white uppercase tracking-wider">Abrir Carteirinha</span>
                    </Link>
                </div>
            </div>
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-[50px] rounded-full pointer-events-none"></div>
        </section>

        {/* 3. MENU DE NAVEGAÇÃO */}
        <div className="space-y-6">
            <div className="space-y-2">
                <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-2">Minha Conta</h3>
                <div className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
                    <MenuItem href="/perfil" icon={<FileText size={18} />} label="Dados Pessoais" desc="Atualizar cadastro" />
                    {/* 🦈 Link para Nova Página de Pedidos (ID 16) */}
                    <MenuItem href="/configuracoes/pedidos" icon={<History size={18} />} label="Meus Pedidos" desc="Acompanhar compras" badge="Novo" />
                    <MenuItem href="/configuracoes/seguranca" icon={<Shield size={18} />} label="Segurança & Senha" desc="Proteger conta" />
                </div>
            </div>

            <div className="space-y-2">
                <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-2">Preferências</h3>
                <div className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
                     <div className="w-full flex items-center justify-between p-4 border-b border-zinc-800 last:border-0 hover:bg-zinc-800/50 transition">
                        <div className="flex items-center gap-3 text-zinc-400">
                            <Bell size={18} />
                            <span className="text-sm font-medium text-zinc-200">Notificações</span>
                        </div>
                        <button onClick={() => setNotificacoes(!notificacoes)} className={`w-10 h-5 rounded-full relative transition-colors duration-300 ${notificacoes ? "bg-emerald-500" : "bg-zinc-700"}`}>
                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform duration-300 ${notificacoes ? "left-6" : "left-1"}`}></div>
                        </button>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-2">Suporte</h3>
                <div className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
                    <MenuItem href="/configuracoes/suporte" icon={<AlertTriangle size={18} />} label="Denúncias & Ajuda" desc="Reportar problemas" />
                    <MenuItem href="/configuracoes/termos" icon={<FileText size={18} />} label="Termos de Uso" />
                </div>
            </div>
        </div>

        {/* ZONA DE PERIGO (MANTIDA) */}
        <div className="space-y-3 pt-4 border-t border-zinc-900 mt-6">
            <h3 className="text-[10px] font-black text-red-500/50 uppercase tracking-[0.2em] mb-2 px-1 flex items-center gap-2">
                <AlertTriangle size={12}/> Zona de Risco
            </h3>
            
            <button onClick={handleToggleAccount} disabled={actionLoading} className={`w-full p-4 rounded-2xl border flex items-center justify-center gap-2 font-bold uppercase text-xs tracking-widest transition ${user?.status === 'ativo' ? 'bg-zinc-900 border-zinc-800 text-yellow-500 hover:bg-yellow-500/10' : 'bg-emerald-900/20 border-emerald-500/30 text-emerald-500 hover:bg-emerald-900/30'}`}>
                {actionLoading ? <Loader2 className="animate-spin" size={16}/> : (user?.status === 'ativo' ? <><PowerOff size={16} /> Pausar Conta</> : <><Power size={16} /> Reativar Conta</>)}
            </button>

            <button onClick={handleLogout} className="w-full bg-zinc-900 p-4 rounded-2xl border border-zinc-800 flex items-center justify-center gap-2 text-zinc-300 font-bold uppercase text-xs tracking-widest hover:bg-zinc-800 hover:text-white transition">
                <LogOut size={16} /> Sair da Conta
            </button>

            <button onClick={handleDeleteAccount} disabled={actionLoading} className="w-full bg-red-950/10 p-4 rounded-2xl border border-red-900/20 flex items-center justify-center gap-2 text-red-500/70 font-bold uppercase text-xs tracking-widest hover:bg-red-900/20 hover:text-red-500 transition">
                {actionLoading ? <Loader2 className="animate-spin" size={16}/> : <><Trash2 size={16} /> Excluir Permanentemente</>}
            </button>
            
            <p className="text-center text-[10px] text-zinc-700 font-mono pt-4">AAAKN App v2.0 • ID: {user?.uid?.slice(0,8).toUpperCase()}</p>
        </div>

      </main>
    </div>
  );
}

function MenuItem({ href, icon, label, desc, badge }: { href: string, icon: React.ReactNode, label: string, desc?: string, badge?: string }) {
    return (
        <Link href={href} className="w-full flex items-center justify-between p-4 border-b border-zinc-800 last:border-0 hover:bg-zinc-800/50 transition group">
            <div className="flex items-center gap-3 text-zinc-400 group-hover:text-white transition">
                {icon}
                <div className="text-left">
                    <span className="text-sm font-medium text-zinc-200 group-hover:text-white block leading-tight">{label}</span>
                    {desc && <span className="text-[10px] text-zinc-500 font-normal">{desc}</span>}
                </div>
            </div>
            <div className="flex items-center gap-2">
                {badge && <span className="bg-emerald-500/20 text-emerald-400 text-[9px] font-bold px-2 py-0.5 rounded border border-emerald-500/30 uppercase">{badge}</span>}
                <ChevronRight size={16} className="text-zinc-600 group-hover:text-emerald-500 transition" />
            </div>
        </Link>
    );
}



