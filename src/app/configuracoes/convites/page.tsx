"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock3,
  Copy,
  History,
  Loader2,
  PlusCircle,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { buildLoginPath } from "@/lib/authRedirect";
import {
  MEMBER_INVITE_BONUS_LIMIT,
  MEMBER_INVITE_DAILY_LIMIT,
  resolveInviteQuotaDayKey,
  resolveTenantInviteQuotaState,
} from "@/lib/inviteQuota";
import {
  fetchUserInviteDashboard,
  requestMoreMemberInvites,
  revokeTenantInvite,
  type TenantUserInviteDashboard,
} from "@/lib/tenantService";
import { withTenantSlug } from "@/lib/tenantRouting";

const EMPTY_INVITE_DASHBOARD: TenantUserInviteDashboard = {
  invites: [],
  entries: [],
  totalCreatedToday: 0,
  remainingToday: MEMBER_INVITE_DAILY_LIMIT,
  limitPerDay: MEMBER_INVITE_DAILY_LIMIT,
  quota: resolveTenantInviteQuotaState(null, ""),
};

const formatInviteCountdown = (value: string, nowMs: number): string => {
  if (!value) return "Sem validade";
  const expiresAt = new Date(value).getTime();
  if (Number.isNaN(expiresAt)) return "Sem validade";
  const diff = expiresAt - nowMs;
  if (diff <= 0) return "Expirado";
  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  const totalDays = Math.floor(totalHours / 24);
  if (totalDays >= 1) {
    return `${totalDays}d ${totalHours % 24}h`;
  }
  return `${Math.max(1, totalHours)}h`;
};

const formatInviteCreatedAt = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "data indisponivel";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
};

const formatCooldown = (remainingMs: number): string => {
  const safeMs = Math.max(0, remainingMs);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

const resolveApprovalLabel = (
  status: TenantUserInviteDashboard["entries"][number]["status"]
): { label: string; className: string } => {
  if (status === "approved") {
    return {
      label: "Aprovado",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    };
  }
  if (status === "pending") {
    return {
      label: "Aguardando",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    };
  }
  if (status === "rejected") {
    return {
      label: "Não aprovado",
      className: "border-red-500/30 bg-red-500/10 text-red-300",
    };
  }
  return {
    label: "Sem uso",
    className: "border-zinc-700 bg-zinc-900 text-zinc-300",
  };
};

const resolveInviteActivity = (
  invite: TenantUserInviteDashboard["entries"][number]["invite"],
  nowMs: number
): { label: string; className: string; isActionable: boolean } => {
  if (invite.isRevoked) {
    return {
      label: "Revogado",
      className: "border-red-500/30 bg-red-500/10 text-red-300",
      isActionable: false,
    };
  }
  if (invite.expiresAt) {
    const expiresAt = new Date(invite.expiresAt).getTime();
    if (!Number.isNaN(expiresAt) && expiresAt <= nowMs) {
      return {
        label: "Expirado",
        className: "border-zinc-700 bg-zinc-900 text-zinc-300",
        isActionable: false,
      };
    }
  }
  if (!invite.isActive) {
    return {
      label: "Encerrado",
      className: "border-zinc-700 bg-zinc-900 text-zinc-300",
      isActionable: false,
    };
  }
  return {
    label: "Ativo",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    isActionable: true,
  };
};

export default function SettingsInvitesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantName, tenantSlug } = useTenantTheme();

  const [dashboard, setDashboard] = useState<TenantUserInviteDashboard>(EMPTY_INVITE_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [copiedInviteId, setCopiedInviteId] = useState("");
  const [revokingInviteId, setRevokingInviteId] = useState("");
  const [requestingBonus, setRequestingBonus] = useState(false);
  const [origin, setOrigin] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());

  const effectiveTenantId =
    tenantId.trim() ||
    (typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "");
  const settingsHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes")
    : "/configuracoes";
  const pageHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/convites")
    : "/configuracoes/convites";
  const historyHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/convites/aprovados")
    : "/configuracoes/convites/aprovados";
  const inviteCadastroPath = tenantSlug.trim()
    ? withTenantSlug(tenantSlug, "/cadastro")
    : "/cadastro";

  const refreshDashboard = useCallback(async () => {
    if (!effectiveTenantId || !user?.uid) {
      setDashboard(EMPTY_INVITE_DASHBOARD);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const nextDashboard = await fetchUserInviteDashboard({
        tenantId: effectiveTenantId,
        userId: user.uid,
        limit: 50,
      });
      setDashboard(nextDashboard);
    } catch (error: unknown) {
      console.error(error);
      setDashboard(EMPTY_INVITE_DASHBOARD);
      addToast("Não foi possível carregar seus convites.", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, effectiveTenantId, user?.uid]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(buildLoginPath(pageHref));
    }
  }, [authLoading, pageHref, router, user]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const liveQuota = useMemo(() => {
    const todayKey = resolveInviteQuotaDayKey(nowMs);
    const unlockMs = dashboard.quota.unlockAt ? new Date(dashboard.quota.unlockAt).getTime() : Number.NaN;
    const isPending = Number.isFinite(unlockMs) && unlockMs > nowMs;
    const isGranted = !isPending && dashboard.quota.bonusDayKey === todayKey;
    const bonusLimit = isGranted ? MEMBER_INVITE_BONUS_LIMIT : 0;

    return {
      ...dashboard.quota,
      status: isPending ? "pending" : isGranted ? "granted" : "idle",
      canRequestMore: !isPending && !isGranted,
      remainingMs: isPending ? unlockMs - nowMs : 0,
      bonusLimit,
      totalLimit: MEMBER_INVITE_DAILY_LIMIT + bonusLimit,
    };
  }, [dashboard.quota, nowMs]);

  useEffect(() => {
    if (liveQuota.status !== "pending" || !liveQuota.unlockAt) return;
    if (liveQuota.remainingMs > 0) return;
    void refreshDashboard();
  }, [liveQuota.remainingMs, liveQuota.status, liveQuota.unlockAt, refreshDashboard]);

  const activeEntries = useMemo(
    () =>
      dashboard.entries.filter((entry) => {
        const activity = resolveInviteActivity(entry.invite, nowMs);
        return activity.label === "Ativo" && entry.status !== "approved";
      }),
    [dashboard.entries, nowMs]
  );

  const historyEntriesCount = dashboard.entries.filter((entry) => {
    const activity = resolveInviteActivity(entry.invite, nowMs);
    return entry.status === "approved" || activity.label !== "Ativo";
  }).length;

  const activeInviteCount = activeEntries.length;
  const approvedInviteCount = dashboard.entries.filter(
    (entry) => entry.status === "approved"
  ).length;
  const liveRemainingToday = Math.max(0, liveQuota.totalLimit - dashboard.totalCreatedToday);

  const buildInviteLink = (token: string): string =>
    `${origin}${inviteCadastroPath}?invite=${encodeURIComponent(token)}`;

  const copyInviteLink = async (inviteId: string, token: string) => {
    if (!token) return;
    try {
      const nextOrigin =
        origin || (typeof window !== "undefined" ? window.location.origin : "");
      await navigator.clipboard.writeText(
        `${nextOrigin}${inviteCadastroPath}?invite=${encodeURIComponent(token)}`
      );
      setCopiedInviteId(inviteId);
      addToast("Link copiado para compartilhar.", "success");
      window.setTimeout(() => {
        setCopiedInviteId((current) => (current === inviteId ? "" : current));
      }, 1800);
    } catch {
      addToast("Não consegui copiar o link agora.", "error");
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!effectiveTenantId || !user?.uid || !inviteId || revokingInviteId) return;
    try {
      setRevokingInviteId(inviteId);
      await revokeTenantInvite({
        tenantId: effectiveTenantId,
        inviteId,
        currentUserId: user.uid,
      });
      await refreshDashboard();
      addToast("Convite encerrado.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast(error instanceof Error ? error.message : "Erro ao encerrar convite.", "error");
    } finally {
      setRevokingInviteId("");
    }
  };

  const handleRequestMoreInvites = async () => {
    if (!effectiveTenantId || requestingBonus) return;
    try {
      setRequestingBonus(true);
      const nextQuota = await requestMoreMemberInvites({ tenantId: effectiveTenantId });
      setDashboard((current) => ({
        ...current,
        quota: nextQuota,
        limitPerDay: nextQuota.totalLimit,
        remainingToday: Math.max(0, nextQuota.totalLimit - current.totalCreatedToday),
      }));
      addToast("Pedido feito. Seus 5 novos convites liberam em 1 hora.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast(
        error instanceof Error ? error.message : "Não consegui pedir mais convites agora.",
        "error"
      );
    } finally {
      setRequestingBonus(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="animate-spin text-amber-300" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] pb-24 text-white">
      <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-white/5 bg-[#050505]/90 p-4 backdrop-blur-md">
        <Link
          href={settingsHref}
          className="rounded-full p-2 text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
        >
          <ArrowLeft size={24} />
        </Link>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">
            Convites
          </p>
          <h1 className="text-xl font-black uppercase tracking-tight text-white">
            Convites ativos
          </h1>
        </div>
      </header>

      <main className="space-y-6 p-4">
        <section className="overflow-hidden rounded-[2rem] border border-amber-400/20 bg-[linear-gradient(135deg,rgba(120,53,15,0.3),rgba(10,10,10,0.96)_48%,rgba(120,53,15,0.18))] p-5 shadow-[0_18px_60px_rgba(245,158,11,0.12)]">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-300">
                Convite travado na tenant
              </p>
              <h2 className="mt-2 text-lg font-black uppercase text-white">
                Todo link desta tela cai direto em {tenantName || "sua atlética"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-amber-100/75">
                Quem usar um convite daqui ja entra com o cadastro preso nesta tenant, sem
                possibilidade de trocar a atlética durante esse fluxo.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={historyHref}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-100 hover:bg-amber-300/15"
                >
                  <History size={12} />
                  Abrir aprovados e expirados
                </Link>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-white/5 bg-black/35 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Cota de hoje
                </p>
                <p className="mt-2 text-2xl font-black text-white">
                  {liveRemainingToday}
                  <span className="ml-1 text-sm text-zinc-500">/{liveQuota.totalLimit}</span>
                </p>
                <p className="mt-2 text-xs text-zinc-400">
                  {dashboard.totalCreatedToday} link
                  {dashboard.totalCreatedToday === 1 ? "" : "s"} gerado
                  {dashboard.totalCreatedToday === 1 ? "" : "s"} hoje.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void handleRequestMoreInvites()}
                disabled={!liveQuota.canRequestMore || requestingBonus}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-100 transition hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {requestingBonus ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
                {requestingBonus ? "Solicitando" : "Pedir Mais Convites"}
              </button>

              {liveQuota.status === "pending" ? (
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
                    Pedido em processamento
                  </p>
                  <p className="mt-2 text-sm font-semibold text-cyan-100">
                    Os {MEMBER_INVITE_BONUS_LIMIT} novos convites liberam em {formatCooldown(liveQuota.remainingMs)}.
                  </p>
                </div>
              ) : null}

              {liveQuota.status === "granted" ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">
                    Bonus liberado
                  </p>
                  <p className="mt-2 text-sm font-semibold text-emerald-100">
                    Seus {MEMBER_INVITE_BONUS_LIMIT} convites extras ja estao disponiveis hoje.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/70 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                Convites ativos
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                Convites ainda válidos, sem expiração e sem aprovação final.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/15 bg-amber-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-100">
                {loading ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                {activeInviteCount} ativo{activeInviteCount === 1 ? "" : "s"}
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-zinc-900 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300">
                <History size={12} />
                {historyEntriesCount} no histórico
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-[220px] items-center justify-center rounded-3xl border border-dashed border-zinc-800 bg-black/25">
              <Loader2 className="animate-spin text-amber-300" size={24} />
            </div>
          ) : activeEntries.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-zinc-800 bg-black/25 p-8 text-center">
              <UserPlus className="mx-auto text-zinc-600" size={28} />
              <p className="mt-3 text-sm font-semibold text-zinc-400">
                Nenhum convite ativo por aqui.
              </p>
              <Link
                href={historyHref}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-100 hover:bg-amber-300/15"
              >
                <History size={12} />
                Ver aprovados e expirados
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-3xl border border-zinc-800">
              <table className="min-w-[1120px] w-full text-left">
                <thead className="bg-zinc-950">
                  <tr className="border-b border-zinc-800 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                    <th className="px-4 py-3">Convite</th>
                    <th className="px-4 py-3">Expira em</th>
                    <th className="px-4 py-3">Usuário cadastrado</th>
                    <th className="px-4 py-3">Turma</th>
                    <th className="px-4 py-3">Aprovado</th>
                    <th className="px-4 py-3">Ativo</th>
                    <th className="px-4 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {activeEntries.map((entry) => {
                    const approval = resolveApprovalLabel(entry.status);
                    const activity = resolveInviteActivity(entry.invite, nowMs);
                    const inviteLink = buildInviteLink(entry.invite.token);

                    return (
                      <tr key={entry.invite.id} className="border-b border-zinc-900 align-top">
                        <td className="px-4 py-4">
                          <p className="max-w-[360px] break-all font-mono text-[11px] leading-5 text-zinc-300">
                            {inviteLink}
                          </p>
                          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">
                            Criado em {formatInviteCreatedAt(entry.invite.createdAt)}
                          </p>
                        </td>
                        <td className="px-4 py-4 text-sm font-semibold text-white">
                          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-[11px] font-bold uppercase text-zinc-200">
                            <Clock3 size={12} className="text-amber-300" />
                            {formatInviteCountdown(entry.invite.expiresAt, nowMs)}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-bold text-white">
                            {entry.requesterName || "Aguardando uso"}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {entry.requesterEmail || "Nenhum cadastro vinculado ainda"}
                          </p>
                        </td>
                        <td className="px-4 py-4 text-sm font-semibold text-zinc-300">
                          {entry.requesterTurma || "Sem turma"}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase ${approval.className}`}
                          >
                            {approval.label}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase ${activity.className}`}
                          >
                            {activity.label}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void copyInviteLink(entry.invite.id, entry.invite.token)}
                              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-200 hover:border-zinc-500 hover:text-white"
                            >
                              {copiedInviteId === entry.invite.id ? <Check size={12} /> : <Copy size={12} />}
                              {copiedInviteId === entry.invite.id ? "Copiado" : "Copiar"}
                            </button>
                            {activity.isActionable ? (
                              <button
                                type="button"
                                onClick={() => void handleRevokeInvite(entry.invite.id)}
                                disabled={revokingInviteId === entry.invite.id}
                                className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-red-300 hover:bg-red-500/20 disabled:opacity-60"
                              >
                                {revokingInviteId === entry.invite.id ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <X size={12} />
                                )}
                                Encerrar
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Link
              href={historyHref}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-200 hover:border-zinc-500 hover:text-white"
            >
              <History size={12} />
              Ver aprovados e expirados
            </Link>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/5 bg-zinc-950/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
              Ativos
            </p>
            <p className="mt-2 text-2xl font-black text-white">{activeInviteCount}</p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-zinc-950/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
              Aprovados
            </p>
            <p className="mt-2 text-2xl font-black text-white">{approvedInviteCount}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
