"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowLeft, Bell, LogOut, ChevronRight,
  FileText, Smartphone,
  Trash2, Power, PowerOff, AlertTriangle, Loader2,
  Crown, Shield, History, Sparkles, Copy, Check, UserPlus, Store, HeartHandshake
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { auth } from "@/lib/backend";
import { deleteUser } from "@/lib/supa/auth";
import { logActivity } from "../../lib/logger";
import { softDeleteAccount, toggleAccountStatus } from "../../lib/settingsService";
import {
  createMemberInvite,
  fetchUserInviteDashboard,
  type TenantUserInviteDashboard,
} from "../../lib/tenantService";
import { fetchCurrentMiniVendorProfile } from "@/lib/miniVendorService";
import { resolveTenantInviteQuotaState } from "@/lib/inviteQuota";
import { getTurmaImage } from "../../constants/turmaImages";
import { resolvePlanTheme, resolveUserPlanIcon } from "../../constants/planVisuals";
import { buildLoginPath } from "@/lib/authRedirect";
import { getRoleLabel, resolveEffectiveAccessRole } from "@/lib/roles";
import {
  createDefaultTenantAppModulesConfig,
  fetchEffectiveTenantAppModulesConfig,
  isTenantAppModuleVisible,
} from "@/lib/tenantAppModulesService";
import { fetchMentorshipLabels } from "@/lib/mentorshipService";
import { withTenantSlug } from "@/lib/tenantRouting";

const EMPTY_INVITE_DASHBOARD: TenantUserInviteDashboard = {
  invites: [],
  entries: [],
  totalCreatedToday: 0,
  remainingToday: 5,
  limitPerDay: 5,
  quota: resolveTenantInviteQuotaState(null, ""),
};

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantName, tenantSlug } = useTenantTheme();
  
  const [actionLoading, setActionLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [notificacoes, setNotificacoes] = useState(true);
  const [miniVendorBadge, setMiniVendorBadge] = useState("");
  const [mentorshipHubTitle, setMentorshipHubTitle] = useState("Apadrinhamento");
  const [inviteDashboard, setInviteDashboard] =
    useState<TenantUserInviteDashboard>(EMPTY_INVITE_DASHBOARD);
  const [modulesConfig, setModulesConfig] = useState(createDefaultTenantAppModulesConfig);
  const effectiveTenantId =
    tenantId.trim() ||
    (typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "");

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
      router.push(buildLoginPath("/configuracoes"));
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
        router.push(buildLoginPath("/configuracoes"));
    } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao processar exclusão.", "error");
    } finally {
        setActionLoading(false);
    }
  };

  const copyInviteLink = async (link: string) => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setInviteCopied(true);
      addToast("Link copiado para compartilhar.", "success");
    } catch {
      addToast("Não consegui copiar. O link ficou visível na tela.", "info");
    }
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!user?.uid || !tenantId.trim()) {
        if (mounted) setMiniVendorBadge("");
        return;
      }

      try {
        const profile = await fetchCurrentMiniVendorProfile({
          tenantId,
          userId: user.uid,
          forceRefresh: true,
        });
        if (!mounted) return;
        if (!profile) {
          setMiniVendorBadge("Novo");
          return;
        }
        setMiniVendorBadge(
          profile.status === "approved"
            ? "Aprovado"
            : profile.status === "rejected"
            ? "Revisar"
            : profile.status === "disabled"
            ? "Bloqueado"
            : "Pendente"
        );
      } catch {
        if (mounted) setMiniVendorBadge("");
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [tenantId, user?.uid]);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!effectiveTenantId) {
        if (mounted) setModulesConfig(createDefaultTenantAppModulesConfig());
        return;
      }

      try {
        const nextConfig = await fetchEffectiveTenantAppModulesConfig({
          tenantId: effectiveTenantId,
          tenantSlug,
          forceRefresh: true,
        });
        if (mounted) setModulesConfig(nextConfig);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) setModulesConfig(createDefaultTenantAppModulesConfig());
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [effectiveTenantId, tenantSlug]);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!effectiveTenantId) {
        if (mounted) setMentorshipHubTitle("Apadrinhamento");
        return;
      }
      try {
        const labels = await fetchMentorshipLabels({
          tenantId: effectiveTenantId,
          forceRefresh: true,
        });
        if (mounted) setMentorshipHubTitle(labels.hubTitle || "Apadrinhamento");
      } catch {
        if (mounted) setMentorshipHubTitle("Apadrinhamento");
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [effectiveTenantId]);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!effectiveTenantId || !user?.uid) {
        if (mounted) setInviteDashboard(EMPTY_INVITE_DASHBOARD);
        return;
      }
      try {
        const nextDashboard = await fetchUserInviteDashboard({
          tenantId: effectiveTenantId,
          userId: user.uid,
          limit: 20,
        });
        if (mounted) setInviteDashboard(nextDashboard);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) setInviteDashboard(EMPTY_INVITE_DASHBOARD);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [effectiveTenantId, user?.uid]);

  if (!user) return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500"/></div>;

  const extra = typeof user.extra === "object" && user.extra !== null
    ? (user.extra as Record<string, unknown>)
    : {};
  const isTurmaLeader = extra.turmaLeader === true;
  const roleLabel = getRoleLabel(resolveEffectiveAccessRole(user));
  const rawPlanLabel =
    (typeof user.plano === "string" && user.plano.trim()) ||
    (typeof user.plano_badge === "string" && user.plano_badge.trim()) ||
    "";
  const isGuestRole = String(user.role || "").toLowerCase() === "guest";
  const planLabel =
    !isGuestRole && rawPlanLabel.toLowerCase() === "visitante"
      ? "Bicho Solto"
      : (rawPlanLabel || "Bicho Solto");
  const normalizedTenantStatus =
    typeof user.tenant_status === "string" ? user.tenant_status.trim().toLowerCase() : "";
  const canGenerateInvite =
    !isGuestRole &&
    effectiveTenantId.length > 0 &&
    (normalizedTenantStatus === "" || normalizedTenantStatus === "approved");
  const planTheme = resolvePlanTheme(typeof user.plano_cor === "string" ? user.plano_cor : "zinc");
  const planBadgeClasses = planTheme.badgeClass;
  const turmaLabel = typeof user.turma === "string" && user.turma.trim() ? user.turma.trim() : "T?";
  const turmaLogo =
    (typeof user.turmaPhoto === "string" && user.turmaPhoto.trim()) ||
    getTurmaImage(turmaLabel, "/logo.png");
  const PlanIcon = resolveUserPlanIcon(
    typeof user.plano_icon === "string" ? user.plano_icon : null,
    planLabel,
    Crown
  );
  const perfilHref = tenantSlug ? withTenantSlug(tenantSlug, "/perfil") : "/perfil";
  const dashboardHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/dashboard")
    : "/dashboard";
  const planosHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/planos")
    : "/planos";
  const carteirinhaHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/carteirinha")
    : "/carteirinha";
  const pedidosHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/pedidos")
    : "/configuracoes/pedidos";
  const segurancaHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/seguranca")
    : "/configuracoes/seguranca";
  const apadrinhamentoHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/apadrinhamento")
    : "/configuracoes/apadrinhamento";
  const suporteHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/suporte")
    : "/configuracoes/suporte";
  const termosHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/termos")
    : "/configuracoes/termos";
  const liderTurmaHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/lider-turma")
    : "/configuracoes/lider-turma";
  const convitesHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/convites")
    : "/configuracoes/convites";
  const miniVendorHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/mini-vendor")
    : "/configuracoes/mini-vendor";
  const showMiniVendorMenu = isTenantAppModuleVisible(modulesConfig, "mini_vendor");

  const handleCreateInvite = async () => {
    if (!canGenerateInvite) {
      addToast("Seu perfil ainda não pode gerar convite nesta atlética.", "error");
      return;
    }

    try {
      setInviteLoading(true);
      setInviteCopied(false);

      const invite = await createMemberInvite({
        tenantId: effectiveTenantId,
        maxUses: 1,
        expiresInHours: 72,
      });

      const invitePath = tenantSlug.trim()
        ? withTenantSlug(tenantSlug, "/cadastro")
        : "/cadastro";
      const nextLink = `${window.location.origin}${invitePath}?invite=${encodeURIComponent(invite.token)}`;
      setInviteLink(nextLink);
      await copyInviteLink(nextLink);

      await logActivity(
        user.uid,
        user.nome,
        "CREATE",
        "Convite/Membro",
        `Gerou convite social para ${tenantName || effectiveTenantId}`
      );
      const nextDashboard = await fetchUserInviteDashboard({
        tenantId: effectiveTenantId,
        userId: user.uid,
        limit: 20,
      });
      setInviteDashboard(nextDashboard);
    } catch (error: unknown) {
      console.error(error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao gerar convite.";
      addToast(message, "error");
    } finally {
      setInviteLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-24 font-sans selection:bg-emerald-500">
      
      {/* HEADER */}
      <header className="p-4 sticky top-0 z-30 flex items-center gap-4 border-b border-white/5 bg-[#050505]/90 backdrop-blur-md">
        <Link href={dashboardHref} className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full transition hover:bg-zinc-900">
            <ArrowLeft size={24} />
        </Link>
        <h1 className="font-black text-xl italic uppercase tracking-tighter text-white">Central do Sócio</h1>
      </header>

      <main className="p-4 space-y-6 animate-in slide-in-from-bottom-4 duration-500">
        
        {/* 1. CARTÃO DE PERFIL + PLANO (Vindo do antigo Menu) */}
        <section className="relative overflow-hidden bg-gradient-to-br from-zinc-900 to-black border border-zinc-800 rounded-[2rem] p-5">
            <div className="flex items-center gap-4 relative z-10">
                <div className="relative">
                    <div className="relative h-20 w-20 rounded-full bg-brand-gradient p-1 shadow-brand">
                        <Image 
                            src={user.foto || "https://github.com/shadcn.png"} 
                            alt="Perfil" 
                            fill
                            sizes="80px"
                            className="object-cover rounded-full border-4 border-[#050505]"
                            
                        />
                    </div>
                    <div className="absolute -bottom-1 -right-1 z-10 h-8 w-8 overflow-hidden rounded-full border-[3px] border-[#050505] bg-zinc-950 shadow-brand">
                        <Image
                            src={turmaLogo}
                            alt={`Logo da turma ${turmaLabel}`}
                            fill
                            sizes="32px"
                            unoptimized
                            className="object-cover"
                        />
                    </div>
                </div>

                <div className="flex-1">
                    <h2 className="font-black text-xl text-white leading-none mb-1">{user.nome}</h2>
                    <p className="text-xs text-zinc-400 font-medium mb-3">{roleLabel} • {turmaLabel}</p>
                    
                    <div className="flex items-center gap-2 mb-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider flex items-center gap-1 ${planBadgeClasses}`}>
                            <PlanIcon size={10} strokeWidth={3} /> {planLabel}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${user.status === 'ativo' ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 'text-red-500 bg-red-500/10 border-red-500/20'}`}>
                            {user.status}
                        </span>
                    </div>

                    <Link href={carteirinhaHref} className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 transition px-3 py-1.5 rounded-lg border border-white/10 group">
                        <Smartphone size={14} className="text-emerald-500" />
                        <span className="text-[10px] font-bold text-zinc-300 group-hover:text-white uppercase tracking-wider">Abrir Carteirinha</span>
                    </Link>
                </div>
            </div>
            <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-brand-primary/10 blur-[50px]"></div>
        </section>

        {canGenerateInvite && (
          <section className="relative overflow-hidden rounded-[2rem] border border-amber-400/25 bg-[linear-gradient(135deg,rgba(120,53,15,0.35),rgba(10,10,10,0.96)_45%,rgba(120,53,15,0.2))] p-5 shadow-[0_18px_60px_rgba(245,158,11,0.16)]">
            <div className="absolute -top-12 right-0 h-28 w-28 rounded-full bg-amber-300/20 blur-3xl animate-pulse pointer-events-none"></div>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.22),transparent_38%)] pointer-events-none"></div>

            <div className="relative z-10 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/30 bg-amber-300/10 text-amber-200 shadow-[0_0_24px_rgba(251,191,36,0.18)]">
                  <Sparkles size={20} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-300">
                    Convite de Amigos
                  </p>
                  <h3 className="mt-1 text-lg font-black uppercase tracking-tight text-white">
                    Traga mais gente para {tenantName || "sua atlética"}
                  </h3>
                  <p className="mt-1 text-xs text-amber-100/75">
                    Gera 1 link dourado, com 1 uso e validade de 72h. O cadastro continua entrando como
                    <span className="font-black text-amber-300"> user</span>.
                  </p>
                </div>
              </div>

              <button
                onClick={() => void handleCreateInvite()}
                disabled={inviteLoading || inviteDashboard.remainingToday <= 0}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl border border-amber-200/30 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 px-5 py-4 text-xs font-black uppercase tracking-[0.24em] text-[#1b1300] shadow-[0_18px_45px_rgba(245,158,11,0.32)] transition duration-300 hover:scale-[1.01] hover:shadow-[0_22px_60px_rgba(245,158,11,0.42)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="absolute inset-y-0 left-[-30%] w-24 -skew-x-12 bg-white/35 blur-xl transition-transform duration-700 group-hover:translate-x-[340%]"></span>
                {inviteLoading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                <span className="relative z-10">
                  {inviteLoading ? "Gerando convite" : "Gerar Convite Dourado"}
                </span>
              </button>

              {inviteLink && (
                <div className="rounded-2xl border border-amber-200/15 bg-black/35 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-300">
                      Link pronto para enviar
                    </p>
                    <button
                      onClick={() => void copyInviteLink(inviteLink)}
                      className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-100 transition hover:bg-amber-300/15"
                    >
                      {inviteCopied ? <Check size={12} /> : <Copy size={12} />}
                      {inviteCopied ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                  <p className="break-all font-mono text-[11px] leading-5 text-zinc-200">{inviteLink}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Link
                  href={convitesHref}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-100 hover:bg-amber-300/15"
                >
                  <History size={12} />
                  Abrir meus convites
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* 3. MENU DE NAVEGAÇÃO */}
        <div className="space-y-6">
            <div className="space-y-2">
                <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-2">Minha Conta</h3>
                <div className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
                    <MenuItem href={perfilHref} icon={<FileText size={18} />} label="Dados Pessoais" desc="Atualizar cadastro" />
                    <MenuItem href={planosHref} icon={<Crown size={18} />} label="Planos da Atlética" desc="Ver níveis e benefícios" />
                    <MenuItem href={convitesHref} icon={<UserPlus size={18} />} label="Meus Convites" desc="Tabela completa dos links gerados" />
                    <MenuItem href={apadrinhamentoHref} icon={<HeartHandshake size={18} />} label={mentorshipHubTitle} desc="Aceitar convites e ver seu vinculo" />
                    {showMiniVendorMenu ? (
                      <MenuItem href={miniVendorHref} icon={<Store size={18} />} label="Mini Vendor" desc="Cadastrar ou editar sua lojinha" badge={miniVendorBadge || undefined} />
                    ) : null}
                    {/* Link para nova página de pedidos (ID 16) */}
                    <MenuItem href={pedidosHref} icon={<History size={18} />} label="Meus Pedidos" desc="Acompanhar compras" badge="Novo" />
                    {isTurmaLeader && (
                      <MenuItem
                        href={liderTurmaHref}
                        icon={<UserPlus size={18} />}
                        label="Lider da Turma"
                        desc="Aprovar pendencias da sua turma"
                        badge="Lider"
                      />
                    )}
                    <MenuItem href={segurancaHref} icon={<Shield size={18} />} label="Segurança & Senha" desc="Proteger conta" badge="Bloqueado" disabled />
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
                    <MenuItem href={suporteHref} icon={<AlertTriangle size={18} />} label="Denúncias & Ajuda" desc="Reportar problemas" />
                    <MenuItem href={termosHref} icon={<FileText size={18} />} label="Termos de Uso" />
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
            
            <p className="text-center text-[10px] text-zinc-700 font-mono pt-4">{tenantName?.trim() || "Atlética"} • ID: {user?.uid?.slice(0,8).toUpperCase()}</p>
        </div>

      </main>
    </div>
  );
}

function MenuItem({ href, icon, label, desc, badge, disabled }: { href: string, icon: React.ReactNode, label: string, desc?: string, badge?: string, disabled?: boolean }) {
    const card = (
        <div className={`w-full flex items-center justify-between p-4 border-b border-zinc-800 last:border-0 transition group ${disabled ? "opacity-60 cursor-not-allowed bg-zinc-900/40" : "hover:bg-zinc-800/50"}`}>
            <div className="flex items-center gap-3 text-zinc-400 group-hover:text-white transition">
                {icon}
                <div className="text-left">
                    <span className="text-sm font-medium text-zinc-200 group-hover:text-white block leading-tight">{label}</span>
                    {desc && <span className="text-[10px] text-zinc-500 font-normal">{desc}</span>}
                </div>
            </div>
            <div className="flex items-center gap-2">
                {badge && (
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${disabled ? "bg-zinc-700/30 text-zinc-400 border-zinc-700" : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"}`}>
                    {badge}
                  </span>
                )}
                {!disabled && <ChevronRight size={16} className="text-zinc-600 group-hover:text-emerald-500 transition" />}
            </div>
        </div>
    );

    if (disabled) {
        return card;
    }

    return (
        <Link href={href} className="block">
            {card}
        </Link>
    );
}
