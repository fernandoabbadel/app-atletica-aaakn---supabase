"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, History, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { buildLoginPath } from "@/lib/authRedirect";
import {
  MEMBER_INVITE_DAILY_LIMIT,
  resolveTenantInviteQuotaState,
} from "@/lib/inviteQuota";
import {
  fetchUserInviteDashboard,
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

const formatInviteCreatedAt = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "data indisponivel";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
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

const resolveInviteActivity = (
  invite: TenantUserInviteDashboard["entries"][number]["invite"],
  nowMs: number
): string => {
  if (invite.isRevoked) return "Revogado";
  if (invite.expiresAt) {
    const expiresAt = new Date(invite.expiresAt).getTime();
    if (!Number.isNaN(expiresAt) && expiresAt <= nowMs) return "Expirado";
  }
  if (!invite.isActive) return "Encerrado";
  return "Ativo";
};

export default function InviteHistoryPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantName, tenantSlug } = useTenantTheme();

  const [dashboard, setDashboard] = useState<TenantUserInviteDashboard>(EMPTY_INVITE_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());

  const effectiveTenantId =
    tenantId.trim() ||
    (typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "");
  const activeHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/convites")
    : "/configuracoes/convites";
  const pageHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/convites/aprovados")
    : "/configuracoes/convites/aprovados";

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
        limit: 80,
      });
      setDashboard(nextDashboard);
    } catch (error: unknown) {
      console.error(error);
      setDashboard(EMPTY_INVITE_DASHBOARD);
      addToast("Nao foi possivel carregar o historico de convites.", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, effectiveTenantId, user?.uid]);

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

  const approvedEntries = useMemo(
    () => dashboard.entries.filter((entry) => entry.status === "approved"),
    [dashboard.entries]
  );
  const closedEntries = useMemo(
    () =>
      dashboard.entries.filter((entry) => {
        if (entry.status === "approved") return false;
        return resolveInviteActivity(entry.invite, nowMs) !== "Ativo";
      }),
    [dashboard.entries, nowMs]
  );

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
          href={activeHref}
          className="rounded-full p-2 text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
        >
          <ArrowLeft size={24} />
        </Link>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">
            Convites
          </p>
          <h1 className="text-xl font-black uppercase tracking-tight text-white">
            Aprovados e expirados
          </h1>
        </div>
      </header>

      <main className="space-y-6 p-4">
        <section className="rounded-[2rem] border border-amber-400/20 bg-[linear-gradient(135deg,rgba(120,53,15,0.24),rgba(10,10,10,0.96)_48%,rgba(120,53,15,0.14))] p-5 shadow-[0_18px_60px_rgba(245,158,11,0.10)]">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">
            Historico da tenant
          </p>
          <h2 className="mt-2 text-lg font-black uppercase text-white">
            Convites encerrados de {tenantName || "sua atletica"}
          </h2>
          <p className="mt-2 text-sm text-amber-100/75">
            Aqui ficam os convites aprovados e os links que ja expiraram, foram encerrados ou revogados.
          </p>
        </section>

        {loading ? (
          <div className="flex min-h-[220px] items-center justify-center rounded-3xl border border-dashed border-zinc-800 bg-black/25">
            <Loader2 className="animate-spin text-amber-300" size={24} />
          </div>
        ) : (
          <>
            <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/70 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                    Convites aprovados
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    Links que viraram cadastro aprovado.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200">
                  <CheckCircle2 size={12} />
                  {approvedEntries.length} aprovado{approvedEntries.length === 1 ? "" : "s"}
                </div>
              </div>

              {approvedEntries.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-zinc-800 bg-black/25 p-6 text-sm text-zinc-500">
                  Nenhum convite aprovado ainda.
                </div>
              ) : (
                <div className="space-y-3">
                  {approvedEntries.map((entry) => (
                    <div key={entry.invite.id} className="rounded-3xl border border-zinc-800 bg-black/25 p-4">
                      <p className="text-sm font-black uppercase text-white">
                        {entry.requesterName || "Cadastro aprovado"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {entry.requesterTurma || "Sem turma"}
                        {entry.requesterEmail ? ` • ${entry.requesterEmail}` : ""}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase">
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
                          Aprovado
                        </span>
                        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300">
                          Criado em {formatInviteCreatedAt(entry.invite.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/70 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                    Expirados e encerrados
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    Convites que ja nao podem mais ser usados.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300">
                  <History size={12} />
                  {closedEntries.length} registro{closedEntries.length === 1 ? "" : "s"}
                </div>
              </div>

              {closedEntries.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-zinc-800 bg-black/25 p-6 text-sm text-zinc-500">
                  Nenhum convite expirado ou encerrado ainda.
                </div>
              ) : (
                <div className="space-y-3">
                  {closedEntries.map((entry) => {
                    const activity = resolveInviteActivity(entry.invite, nowMs);
                    return (
                      <div key={entry.invite.id} className="rounded-3xl border border-zinc-800 bg-black/25 p-4">
                        <p className="text-sm font-black uppercase text-white">
                          {entry.requesterName || "Convite sem uso"}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {entry.requesterTurma || "Sem turma"}
                          {entry.requesterEmail ? ` • ${entry.requesterEmail}` : ""}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase">
                          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300">
                            {activity}
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300">
                            <Clock3 size={11} className="mr-1 inline-flex" />
                            {formatInviteCountdown(entry.invite.expiresAt, nowMs)}
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300">
                            Criado em {formatInviteCreatedAt(entry.invite.createdAt)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
