"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  ChevronDown,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { isPermissionError } from "@/lib/backendErrors";
import {
  deleteAdminUser,
  fetchAdminUsersPage,
  setAdminUserStatus,
  type AdminUserListItem,
} from "@/lib/adminUsersService";
import { adminRecountFollowStatsBatch } from "@/lib/profileService";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";

const PAGE_SIZE = 20;
type LetterGroupId = "todos" | "a-f" | "g-l" | "m-r" | "s-z";

const LETTER_GROUP_OPTIONS: Array<{
  id: LetterGroupId;
  label: string;
  letters: string[];
}> = [
  { id: "todos", label: "Todos", letters: [] },
  { id: "a-f", label: "A-F", letters: ["A", "B", "C", "D", "E", "F"] },
  { id: "g-l", label: "G-L", letters: ["G", "H", "I", "J", "K", "L"] },
  { id: "m-r", label: "M-R", letters: ["M", "N", "O", "P", "Q", "R"] },
  { id: "s-z", label: "S-Z", letters: ["S", "T", "U", "V", "W", "X", "Y", "Z"] },
];

const mergeUniqueUsers = (
  current: AdminUserListItem[],
  next: AdminUserListItem[]
): AdminUserListItem[] => {
  if (!next.length) return current;

  const known = new Set(current.map((row) => row.id));
  const merged = [...current];

  next.forEach((row) => {
    if (known.has(row.id)) return;
    known.add(row.id);
    merged.push(row);
  });

  return merged;
};

const statusLabel: Record<AdminUserListItem["status"], string> = {
  ativo: "Ativo",
  inadimplente: "Inadimplente",
  pendente: "Pendente",
  bloqueado: "Bloqueado",
};

const statusClass: Record<AdminUserListItem["status"], string> = {
  ativo: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  inadimplente: "bg-red-500/10 text-red-400 border-red-500/30",
  pendente: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  bloqueado: "bg-zinc-700/20 text-zinc-300 border-zinc-600/40",
};

export default function AdminUsuariosPage() {
  const { addToast } = useToast();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();

  const [rows, setRows] = useState<AdminUserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<"todos" | AdminUserListItem["plano"]>("todos");
  const [letterGroup, setLetterGroup] = useState<LetterGroupId>("todos");
  const [recountingFollows, setRecountingFollows] = useState(false);

  const loadUsers = useCallback(
    async (options?: { reset?: boolean; cursorId?: string | null }) => {
      const reset = options?.reset ?? false;
      const cursorId = options?.cursorId ?? null;

      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        const page = await fetchAdminUsersPage({
          pageSize: PAGE_SIZE,
          cursorId: reset ? null : cursorId,
          forceRefresh: false,
          tenantId: activeTenantId || undefined,
          letters:
            LETTER_GROUP_OPTIONS.find((option) => option.id === letterGroup)?.letters || [],
        });

        if (reset) setRows(page.users);
        else setRows((prev) => mergeUniqueUsers(prev, page.users));

        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      } catch (error: unknown) {
        if (!isPermissionError(error)) { console.error(error); }
        addToast("Erro ao carregar usuários.", "error");
      } finally {
        if (reset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [activeTenantId, addToast, letterGroup]
  );

  useEffect(() => {
    void loadUsers({ reset: true });
  }, [loadUsers]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const searchOk =
        !term ||
        `${row.nome} ${row.email} ${row.matricula} ${row.turma}`
          .toLowerCase()
          .includes(term);

      const planOk = planFilter === "todos" || row.plano === planFilter;
      return searchOk && planOk;
    });
  }, [rows, search, planFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((row) => row.status === "ativo").length;
    const blocked = rows.filter((row) => row.status === "bloqueado").length;
    return { total, active, blocked };
  }, [rows]);
  const adminDashboardHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin") : "/admin";
  const cadastroConfigHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/usuarios/cadastro")
    : "/admin/usuarios/cadastro";

  const handleToggleStatus = async (row: AdminUserListItem) => {
    const nextStatus: AdminUserListItem["status"] =
      row.status === "bloqueado" ? "ativo" : "bloqueado";

    try {
      await setAdminUserStatus({
        userId: row.id,
        status: nextStatus,
        tenantId: activeTenantId || undefined,
      });
      setRows((prev) =>
        prev.map((user) =>
          user.id === row.id ? { ...user, status: nextStatus } : user
        )
      );
      addToast(
        nextStatus === "bloqueado"
          ? "Usuário bloqueado."
          : "Usuário desbloqueado.",
        "success"
      );
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao atualizar status.", "error");
    }
  };

  const handleDelete = async (userId: string) => {
    const confirmed = window.confirm(
      "Confirmar exclusão permanente deste usuário?"
    );
    if (!confirmed) return;

    try {
      await deleteAdminUser(userId, { tenantId: activeTenantId || undefined });
      setRows((prev) => prev.filter((row) => row.id !== userId));
      addToast("Usuário removido.", "success");
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao remover usuário.", "error");
    }
  };

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    await loadUsers({ reset: false, cursorId: nextCursor });
  };

  const handleRecountFollows = async () => {
    if (recountingFollows) return;
    setRecountingFollows(true);
    try {
      let cursor: string | null = null;
      let hasMoreBatches = true;
      let safetyCounter = 0;
      let totalScanned = 0;
      let totalUpdated = 0;

      while (hasMoreBatches && safetyCounter < 40) {
        safetyCounter += 1;
        const result = await adminRecountFollowStatsBatch({
          batchSize: 180,
          startAfterUid: cursor,
        });
        totalScanned += result.scanned;
        totalUpdated += result.updated;
        hasMoreBatches = result.hasMore && Boolean(result.nextCursor);
        cursor = result.nextCursor;
      }

      if (hasMoreBatches) {
        addToast(
          `Recontagem parcial: ${totalUpdated} ajustados de ${totalScanned}. Clique novamente para continuar.`,
          "info"
        );
      } else {
        addToast(
          `Recontagem concluída: ${totalUpdated} usuários ajustados (${totalScanned} verificados).`,
          "success"
        );
      }
    } catch (error: unknown) {
      if (!isPermissionError(error)) {
        console.error(error);
      }
      addToast("Erro ao recontar followers/following.", "error");
    } finally {
      setRecountingFollows(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={adminDashboardHref}
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
              title="Voltar ao painel admin"
              aria-label="Voltar ao painel admin"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">
                Admin Usuários
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold">
                Paginação 20 em 20 para reduzir leituras
              </p>
            </div>
          </div>
          <Link
            href={cadastroConfigHref}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 transition hover:bg-emerald-500/20"
          >
            <SlidersHorizontal size={14} />
            Configurar Cadastro
          </Link>
          <div className="hidden md:flex items-center gap-3 text-xs font-bold uppercase text-zinc-400">
            <span className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900">
              <Users size={12} className="inline mr-1" /> {stats.total}
            </span>
            <span className="px-2 py-1 rounded border border-emerald-700/50 bg-emerald-900/20 text-emerald-300">
              Ativos {stats.active}
            </span>
            <span className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900">
              Bloqueados {stats.blocked}
            </span>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 space-y-4">
        <section className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="relative w-full md:max-w-md">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, email, turma ou matrícula"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-3 text-sm text-white outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {LETTER_GROUP_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setLetterGroup(option.id)}
                className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase border transition ${
                  letterGroup === option.id
                    ? "bg-emerald-400 text-black border-emerald-300"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white"
                }`}
                title={`Filtrar usuários pelos grupos ${option.label}`}
              >
                {option.label}
              </button>
            ))}
            <button
              onClick={() => void handleRecountFollows()}
              disabled={recountingFollows}
              className="px-3 py-2 rounded-lg text-[11px] font-black uppercase border transition bg-zinc-900 text-cyan-300 border-cyan-700/40 hover:bg-zinc-800 disabled:opacity-60 inline-flex items-center gap-2"
              title="Recontar seguidores e seguindo dos usuários"
            >
              {recountingFollows ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Recontar Follows
            </button>
            {[
              { id: "todos", label: "Todos" },
              { id: "lenda", label: "Lenda" },
              { id: "atleta", label: "Atleta" },
              { id: "cardume", label: "Cardume" },
              { id: "bicho", label: "Bicho" },
            ].map((option) => (
              <button
                key={option.id}
                onClick={() =>
                  setPlanFilter(option.id as "todos" | AdminUserListItem["plano"])
                }
                className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase border transition ${
                  planFilter === option.id
                    ? "bg-white text-black border-white"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white"
                }`}
                title={`Filtrar usuários por plano ${option.label}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-black/40 text-zinc-500 uppercase font-black">
                <tr>
                  <th className="p-4">Usuário</th>
                  <th className="p-4">Turma</th>
                  <th className="p-4">Plano</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center">
                      <Loader2 className="animate-spin mx-auto text-emerald-500" />
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-zinc-500">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-800/40">
                      <td className="p-4">
                        <p className="font-bold text-white">{row.nome}</p>
                        <p className="text-zinc-500">{row.email || "sem email"}</p>
                      </td>
                      <td className="p-4">
                        <p>{row.turma || "-"}</p>
                        <p className="text-zinc-500">Matrícula (RA): {row.matricula || "-"}</p>
                      </td>
                      <td className="p-4 uppercase font-black text-[11px]">{row.plano}</td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-1 rounded border text-[10px] uppercase font-black ${statusClass[row.status]}`}
                        >
                          {statusLabel[row.status]}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={tenantSlug ? withTenantSlug(tenantSlug, `/admin/usuarios/${row.id}`) : `/admin/usuarios/${row.id}`}
                            className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                            title="Editar usuário"
                            aria-label={`Editar usuário ${row.nome}`}
                          >
                            <Pencil size={15} />
                          </Link>
                          <button
                            onClick={() => void handleToggleStatus(row)}
                            className={`p-2 rounded-lg border ${
                              row.status === "bloqueado"
                                ? "bg-emerald-900/20 text-emerald-300 border-emerald-700/40"
                                : "bg-zinc-800 text-zinc-300 border-zinc-700"
                            }`}
                            title={
                              row.status === "bloqueado"
                                ? "Desbloquear"
                                : "Bloquear"
                            }
                            aria-label={
                              row.status === "bloqueado"
                                ? `Desbloquear usuário ${row.nome}`
                                : `Bloquear usuário ${row.nome}`
                            }
                          >
                            {row.status === "bloqueado" ? (
                              <ShieldCheck size={15} />
                            ) : (
                              <Ban size={15} />
                            )}
                          </button>
                          <button
                            onClick={() => void handleDelete(row.id)}
                            className="p-2 rounded-lg bg-red-900/20 text-red-300 border border-red-700/40"
                            title="Excluir"
                            aria-label={`Excluir usuário ${row.nome}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {!loading && hasMore && (
          <button
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            className="w-full py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase tracking-wide hover:bg-zinc-800 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loadingMore ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Carregando
              </>
            ) : (
              <>
                <ChevronDown size={15} /> Carregar mais
              </>
            )}
          </button>
        )}
      </main>
    </div>
  );
}


