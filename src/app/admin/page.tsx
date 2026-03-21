"use client";

import React, { useState, useEffect } from "react";
import { 
  Users, ShoppingBag, Calendar, TrendingUp, 
  ArrowUpRight, Clock, ShieldAlert, Activity, LayoutDashboard
} from "lucide-react";
import Link from "next/link";
import Image from "next/image"; // ðŸ¦ˆ CorreÃ§Ã£o: Next Image
import {
  fetchAdminDashboardBundle,
  type AdminDashboardActivityLog,
  type AdminDashboardRecentUser,
  type AdminDashboardStats,
} from "@/lib/adminDashboardService";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { isPlatformMaster, resolveEffectiveAccessRole } from "@/lib/roles";

// --- INTERFACES (FIM DO ANY) ---
type DashboardStats = AdminDashboardStats;
type RecentUser = AdminDashboardRecentUser;
type ActivityLog = AdminDashboardActivityLog;

const toDateValue = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
    return null;
  }
  if (typeof value === "object" && value !== null) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === "function") {
      const result = toDate.call(value) as Date;
      if (result instanceof Date) return result;
    }
  }
  return null;
};

const formatLogTime = (value: unknown): string => {
  const parsedDate = toDateValue(value);
  if (!parsedDate) return "Agora";
  return parsedDate.toLocaleTimeString();
};

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message || "Erro inesperado.";
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
    const message = [raw.message, raw.details, raw.hint]
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .filter((entry) => entry.length > 0)
      .join(" | ");
    if (message) return message;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // ignora serializacao
    }
  }
  return "Erro inesperado.";
};

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const {
    tenantId: activeTenantId,
    tenantName,
    tenantSigla,
    tenantLogoUrl,
    palette,
  } = useTenantTheme();
  const canOpenMasterPanel =
    isPlatformMaster(user) && resolveEffectiveAccessRole(user) === "master";
  const [stats, setStats] = useState<DashboardStats>({ totalUsers: 0, totalEvents: 0, totalSales: 0, activeChamps: 0 });
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboardData() {
        setLoading(true);
        try {
        const data = await fetchAdminDashboardBundle({
          usersLimit: 5,
          logsLimit: 5,
          tenantId: activeTenantId || undefined,
        });
        setStats(data.stats);
        setRecentUsers(data.recentUsers);
        setRecentActivity(data.recentActivity);
      } catch (error: unknown) {
            console.error(`Erro ao carregar dashboard: ${extractErrorMessage(error)}`, error);
        } finally {
            setLoading(false);
        }
    }

    void fetchDashboardData();
  }, [activeTenantId]);

  if (loading) {
      return (
        <div
          className="min-h-screen animate-pulse bg-[#050505] flex items-center justify-center font-bold"
          style={{ color: "var(--tenant-primary)" }}
        >
            CARREGANDO BASE...
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      
      {/* HEADER */}
            <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-lg">
            <Image
              src={tenantLogoUrl || "/logo.png"}
              alt={`Logo ${tenantSigla || tenantName || "Tenant"}`}
              fill
              className="object-contain p-2"
              unoptimized={(tenantLogoUrl || "").startsWith("http")}
              sizes="64px"
            />
          </div>
          <div>
          <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white">Visao Geral</h1>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: palette.primary }}
          >
            Metricas e atividade em tempo real • {tenantSigla || tenantName || "USC"}
          </p>
        </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/dashboard-modulos"
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-700/40 bg-emerald-900/20 px-4 py-2 text-[11px] font-black uppercase text-emerald-200 hover:bg-emerald-900/35 transition"
          >
            <LayoutDashboard size={14} /> Modulos do App
          </Link>
          {canOpenMasterPanel && (
            <Link
              href="/master"
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-700/40 bg-cyan-900/20 px-4 py-2 text-[11px] font-black uppercase text-cyan-200 hover:bg-cyan-900/35 transition"
            >
              <ShieldAlert size={14} /> Admin Master
            </Link>
          )}
        </div>
      </header>

      {/* STAT CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard 
            title="Total de Atletas" 
            value={stats.totalUsers} 
            icon={<Users size={20} className="text-emerald-500"/>} 
            trend="+12% essa semana"
          />
          <StatCard 
            title="Eventos Criados" 
            value={stats.totalEvents} 
            icon={<Calendar size={20} className="text-blue-500"/>} 
            trend="3 ativos agora"
          />
          <StatCard 
            title="Vendas Loja" 
            value={`R$ ${stats.totalSales}`} 
            icon={<ShoppingBag size={20} className="text-purple-500"/>} 
            trend="Meta batida!"
          />
          <StatCard 
            title="Engajamento" 
            value="98.5%" 
            icon={<TrendingUp size={20} className="text-yellow-500"/>} 
            trend="Recorde historico"
          />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* COLUNA 1: NOVOS USUÃRIOS (2/3 da tela) */}
          <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <div className="flex justify-between items-center mb-6">
                  <h3 className="font-bold text-white uppercase flex items-center gap-2">
                      <ShieldAlert size={18} className="text-emerald-500"/> Novos cadastros
                  </h3>
                  <Link href="/admin/usuarios" className="text-[10px] font-bold text-zinc-500 hover:text-white uppercase flex items-center gap-1 transition">
                      Ver Todos <ArrowUpRight size={12}/>
                  </Link>
              </div>

              <div className="space-y-4">
                  {recentUsers.map((user) => (
                      <div key={user.id} className="flex items-center justify-between p-4 bg-black/40 rounded-2xl border border-zinc-800/50 hover:border-zinc-700 transition group">
                          <div className="flex items-center gap-4">
                              <div className="relative w-10 h-10">
                                  {/* ðŸ¦ˆ CorreÃ§Ã£o da Imagem Aqui (Linha 345 original) */}
                                  <Image 
                                    src={user.foto || "https://github.com/shadcn.png"} 
                                    alt={user.nome} 
                                    fill
                                    className="rounded-full object-cover border border-zinc-700"
                                    
                                  />
                              </div>
                              <div>
                                  <p className="font-bold text-white text-sm transition group-hover:opacity-90" style={{ color: "var(--tenant-accent)" }}>{user.nome}</p>
                                  <p className="text-[10px] text-zinc-500 uppercase font-bold">{user.turma} - {user.role}</p>
                              </div>
                          </div>
                          <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-1 rounded font-mono">
                              {user.createdAt ? "Novo" : "Veterano"}
                          </span>
                      </div>
                  ))}
              </div>
          </div>

          {/* COLUNA 2: ATIVIDADE RECENTE (1/3 da tela) */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="font-bold text-white uppercase mb-6 flex items-center gap-2">
                  <Activity size={18} className="text-orange-500"/> Log do Sistema
              </h3>
              
              <div className="relative border-l border-zinc-800 ml-2 space-y-6">
                  {recentActivity.map((log, idx) => (
                      <div key={log.id || idx} className="pl-6 relative">
                          <div className="absolute -left-[5px] top-1 w-2.5 h-2.5 bg-zinc-800 rounded-full border-2 border-[#050505]"></div>
                          <p className="text-[10px] text-zinc-500 font-mono mb-1 flex items-center gap-1">
                              <Clock size={10}/> {formatLogTime(log.timestamp)}
                          </p>
                          <p className="text-xs text-zinc-300">
                              <span className="font-bold" style={{ color: "var(--tenant-primary)" }}>{log.userName}</span> realizou 
                              <span className="font-bold text-white mx-1">{log.action}</span> 
                              em {log.resource}
                          </p>
                      </div>
                  ))}
                  {recentActivity.length === 0 && (
                      <p className="pl-6 text-xs text-zinc-600 italic">Nenhuma atividade recente.</p>
                  )}
              </div>
          </div>

      </div>
    </div>
  );
}

// Componente Auxiliar para Cards
function StatCard({ title, value, icon, trend }: { title: string, value: string | number, icon: React.ReactNode, trend: string }) {
    return (
        <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition">
            <div className="flex justify-between items-start mb-4">
                <span className="p-3 bg-black rounded-xl border border-zinc-800">{icon}</span>
                <span
                  className="rounded px-2 py-1 text-[10px] font-bold uppercase"
                  style={{
                    backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.12)",
                    color: "var(--tenant-primary)",
                  }}
                >
                  {trend}
                </span>
            </div>
            <p className="text-zinc-500 text-xs font-bold uppercase">{title}</p>
            <p className="text-3xl font-black text-white mt-1">{value}</p>
        </div>
    );
}


