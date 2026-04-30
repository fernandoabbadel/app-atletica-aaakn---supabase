"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchLeagueById,
  fetchLeagueUsers,
  isLeagueCategory,
  saveLeagueConfig,
  type LeagueMemberRecord,
  type LeagueRecord,
  type LeagueUserRecord,
} from "@/lib/leaguesService";
import {
  DEFAULT_LEAGUE_ROLE,
  LEAGUE_ROLE_OPTIONS,
  resolveLeagueRoleLabel,
  sortLeagueMembersByRole,
} from "@/lib/leagueRoles";
import { resolveLeagueLogoSrc } from "@/lib/leagueMedia";
import { withTenantSlug } from "@/lib/tenantRouting";

const getCommissionImage = (record?: LeagueRecord | null) =>
  record?.foto?.trim() || resolveLeagueLogoSrc(record, "/placeholder_liga.png");

const normalizeMember = (member: LeagueMemberRecord): LeagueMemberRecord => ({
  ...member,
  cargo: resolveLeagueRoleLabel(member.cargo || DEFAULT_LEAGUE_ROLE),
});

export function CommissionAdminEditorPage({ leagueId }: { leagueId: string }) {
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const cleanLeagueId = typeof leagueId === "string" ? leagueId.trim() : "";
  const cleanTenantSlug = typeof tenantSlug === "string" ? tenantSlug.trim() : "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [commission, setCommission] = useState<LeagueRecord | null>(null);
  const [users, setUsers] = useState<LeagueUserRecord[]>([]);
  const [members, setMembers] = useState<LeagueMemberRecord[]>([]);
  const [memberSearch, setMemberSearch] = useState("");

  const tenantPath = useCallback(
    (path: string) => (cleanTenantSlug ? withTenantSlug(cleanTenantSlug, path) : path),
    [cleanTenantSlug]
  );

  const loadData = useCallback(async () => {
    if (!cleanLeagueId) {
      setCommission(null);
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [nextCommission, nextUsers] = await Promise.all([
        fetchLeagueById(cleanLeagueId, {
          forceRefresh: true,
          tenantId: tenantId || undefined,
        }),
        fetchLeagueUsers({
          maxResults: 220,
          forceRefresh: true,
          tenantId: tenantId || undefined,
        }),
      ]);

      const isCommission = Boolean(
        nextCommission &&
          (isLeagueCategory(nextCommission, "comissao") || nextCommission.turmaId)
      );
      setCommission(isCommission ? nextCommission : null);
      setMembers(
        isCommission
          ? sortLeagueMembersByRole(nextCommission?.membros || []).map(normalizeMember)
          : []
      );
      setUsers(nextUsers);
    } catch (error: unknown) {
      console.error(error);
      setCommission(null);
      setMembers([]);
      setUsers([]);
      addToast("Erro ao carregar a comissão.", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, cleanLeagueId, tenantId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const availableMembers = useMemo(() => {
    const search = memberSearch.trim().toLowerCase();
    const selectedIds = new Set(members.map((member) => member.id));
    const commissionTurma = (commission?.turmaId || "").trim().toUpperCase();

    return users
      .filter((entry) => !selectedIds.has(entry.id))
      .filter((entry) => {
        if (!search) return true;
        const nome = (entry.nome || "").toLowerCase();
        const turma = (entry.turma || "").toLowerCase();
        return (
          nome.includes(search) ||
          turma.includes(search) ||
          entry.id.toLowerCase().includes(search)
        );
      })
      .sort((left, right) => {
        const leftSameTurma = (left.turma || "").trim().toUpperCase() === commissionTurma;
        const rightSameTurma = (right.turma || "").trim().toUpperCase() === commissionTurma;
        if (leftSameTurma !== rightSameTurma) return leftSameTurma ? -1 : 1;
        return (left.nome || left.id).localeCompare(right.nome || right.id, "pt-BR");
      })
      .slice(0, 18);
  }, [commission?.turmaId, memberSearch, members, users]);

  const addMember = (entry: LeagueUserRecord) => {
    setMembers((current) => {
      if (current.some((member) => member.id === entry.id)) return current;
      return [
        ...current,
        {
          id: entry.id,
          nome: entry.nome || "Aluno",
          cargo: "Diretoria",
          foto: entry.foto || "",
          linkPerfil: `/perfil/${entry.id}`,
        },
      ];
    });
    setMemberSearch("");
  };

  const updateMemberRole = (memberId: string, role: string) => {
    setMembers((current) =>
      current.map((member) =>
        member.id === memberId
          ? { ...member, cargo: resolveLeagueRoleLabel(role) }
          : member
      )
    );
  };

  const removeMember = (memberId: string) => {
    setMembers((current) => current.filter((member) => member.id !== memberId));
  };

  const handleSave = async () => {
    if (!commission || saving) return;

    try {
      setSaving(true);
      const normalizedMembers = sortLeagueMembersByRole(members.map(normalizeMember));
      const presidentName =
        normalizedMembers.find((member) => member.cargo === "Presidente")?.nome || "";

      await saveLeagueConfig({
        id: commission.id,
        actorUserId: user?.uid,
        tenantId: tenantId || undefined,
        data: {
          nome: commission.nome,
          sigla: commission.sigla,
          presidente: presidentName,
          descricao: commission.descricao,
          visaoGeral: commission.visaoGeral || "",
          bizu: commission.bizu,
          foto: commission.foto,
          visivel: commission.visivel !== false,
          ativa: commission.ativa !== false,
          membros: normalizedMembers,
          membrosIds: normalizedMembers.map((member) => member.id),
          membersCount: normalizedMembers.length,
          memberRequests: commission.memberRequests || [],
          eventos: commission.eventos || [],
          perguntas: commission.perguntas || [],
          links: commission.links || [],
          paymentConfig: commission.paymentConfig || null,
          likes: commission.likes || 0,
          status: commission.status || "approved",
          category: "comissao",
          turmaId: commission.turmaId || undefined,
          managerUserIds: commission.managerUserIds || [],
          sidebarLabel: commission.sidebarLabel,
          customCss: commission.customCss,
        },
      });

      setMembers(normalizedMembers);
      setCommission((current) =>
        current
          ? {
              ...current,
              presidente: presidentName,
              membros: normalizedMembers,
              membrosIds: normalizedMembers.map((member) => member.id),
              membersCount: normalizedMembers.length,
            }
          : current
      );
      addToast("Diretoria da comissão salva.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar a diretoria da comissão.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-5 py-4">
          <Loader2 className="animate-spin text-brand" size={18} />
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-400">
            Carregando comissão
          </span>
        </div>
      </div>
    );
  }

  if (!commission) {
    return (
      <div className="min-h-screen bg-[#050505] px-6 py-10 text-white">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">
            Comissão não encontrada
          </p>
          <h1 className="mt-4 text-3xl font-black uppercase tracking-tight text-white">
            Não achei essa página nesta tenant
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Volte para a lista de comissões e abra a diretoria pelo card publicado.
          </p>
          <Link
            href={tenantPath("/admin/comissoes")}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-5 py-3 text-xs font-black uppercase text-brand-accent hover:opacity-90"
          >
            <ArrowLeft size={14} />
            Voltar
          </Link>
        </div>
      </div>
    );
  }

  const imageSrc = getCommissionImage(commission);

  return (
    <div className="min-h-screen bg-[#050505] pb-24 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/92 px-6 py-5 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={tenantPath("/admin/comissoes")}
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
              title="Voltar para comissões"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black uppercase tracking-tight">
                Diretoria da comissão
              </h1>
              <p className="truncate text-[11px] font-bold text-zinc-500">
                {commission.turmaId || commission.sigla} - {commission.nome}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={tenantPath(`/comissoes/${commission.id}`)}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-xs font-black uppercase text-zinc-200 transition hover:border-brand/30 hover:text-brand-accent"
            >
              <ExternalLink size={14} />
              Página pública
            </Link>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="brand-button-solid"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Salvar
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/90 p-5">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/40">
                <Image
                  src={imageSrc}
                  alt={commission.nome}
                  fill
                  sizes="80px"
                  className="object-cover"
                  unoptimized={imageSrc.startsWith("http")}
                />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-brand-accent">
                  {commission.turmaId || "Comissão"}
                </p>
                <h2 className="mt-2 truncate text-2xl font-black text-white">
                  {commission.nome}
                </h2>
                <p className="mt-2 text-sm text-zinc-400">
                  {members.length} {members.length === 1 ? "responsável selecionado" : "responsáveis selecionados"}.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.4rem] border border-white/10 bg-black/30 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                  Diretoria
                </p>
                <p className="mt-2 text-2xl font-black text-white">{members.length}</p>
              </div>
              <div className="rounded-[1.4rem] border border-brand/30 bg-brand-soft p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-brand-accent">
                  Presidente
                </p>
                <p className="mt-2 truncate text-sm font-black text-white">
                  {members.find((member) => member.cargo === "Presidente")?.nome || "Não definido"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/90 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-brand/30 bg-brand-soft p-3 text-brand-accent">
                <Search size={18} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-brand-accent">
                  Adicionar responsáveis
                </p>
                <h3 className="mt-1 text-lg font-black text-white">Alunos disponíveis</h3>
              </div>
            </div>

            <input
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
              placeholder="Pesquisar por nome, turma ou ID"
              className="mt-5 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none focus:border-brand/40"
            />

            <div className="mt-4 space-y-3">
              {availableMembers.length > 0 ? (
                availableMembers.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => addMember(entry)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-left transition hover:border-brand/30"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-white">
                        {entry.nome || "Aluno"}
                      </span>
                      <span className="mt-1 block text-[11px] text-zinc-500">
                        {entry.turma || "Sem turma"}
                      </span>
                    </span>
                    <Plus size={14} className="shrink-0 text-brand-accent" />
                  </button>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/70 p-6 text-center text-xs text-zinc-500">
                  Nenhum aluno disponível com esse filtro.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/90 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-200">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">
                    Responsáveis selecionados
                  </p>
                  <h3 className="mt-1 text-lg font-black text-white">Cargos da comissão</h3>
                </div>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-black/30 px-3 py-2 text-[11px] font-bold text-zinc-300">
                <Users size={14} />
                {members.length}
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {members.length > 0 ? (
                members.map((member) => (
                  <div
                    key={member.id}
                    className="rounded-2xl border border-zinc-800 bg-black/30 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-white">{member.nome}</p>
                        <p className="mt-1 break-all text-[11px] text-zinc-500">{member.id}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeMember(member.id)}
                        className="rounded-full border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 transition hover:border-red-500/30 hover:text-red-300"
                        title="Remover responsável"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <select
                      value={resolveLeagueRoleLabel(member.cargo)}
                      onChange={(event) => updateMemberRole(member.id, event.target.value)}
                      className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-bold uppercase text-brand-accent outline-none focus:border-brand/40"
                    >
                      {LEAGUE_ROLE_OPTIONS.filter((role) => role !== "Membro").map((role) => (
                        <option key={role} value={role} className="bg-zinc-950 text-white">
                          {role}
                        </option>
                      ))}
                    </select>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/70 p-6 text-center text-xs text-zinc-500">
                  Nenhum responsável definido ainda para esta comissão.
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="brand-button-solid"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar diretoria
          </button>
        </div>
      </main>
    </div>
  );
}
