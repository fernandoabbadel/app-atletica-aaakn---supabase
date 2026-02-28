"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  Download,
  ExternalLink,
  Loader2,
  Search,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import {
  addUserToChamada,
  deleteChamadaEntry,
  fetchTreinoById,
  fetchTreinoChamadaPage,
  fetchTreinoRsvpsPage,
  fetchUserDirectory,
  type TreinoChamadaRecord,
  type TreinoRsvpRecord,
  type TreinoUserDirectoryItem,
  upsertChamadaPresence,
  updateChamadaStatus,
} from "@/lib/treinosNativeService";
import { isPermissionError } from "@/lib/backendErrors";

const PAGE_SIZE = 10;

const mergeUniqueById = <T extends { id?: string; userId: string }>(
  current: T[],
  next: T[]
): T[] => {
  if (!next.length) return current;
  const ids = new Set(current.map((row) => `${row.id || row.userId}:${row.userId}`));
  const merged = [...current];

  next.forEach((row) => {
    const key = `${row.id || row.userId}:${row.userId}`;
    if (ids.has(key)) return;
    ids.add(key);
    merged.push(row);
  });

  return merged;
};

export default function AdminTreinoListaPage() {
  const params = useParams<{ id: string }>();
  const treinoId = params?.id?.trim() || "";

  const { addToast } = useToast();

  const [titulo, setTitulo] = useState("Treino");
  const [subtitulo, setSubtitulo] = useState("-");

  const [chamadaRows, setChamadaRows] = useState<TreinoChamadaRecord[]>([]);
  const [rsvpRows, setRsvpRows] = useState<TreinoRsvpRecord[]>([]);

  const [loading, setLoading] = useState(true);

  const [chamadaCursor, setChamadaCursor] = useState<string | null>(null);
  const [rsvpCursor, setRsvpCursor] = useState<string | null>(null);
  const [hasMoreChamada, setHasMoreChamada] = useState(false);
  const [hasMoreRsvp, setHasMoreRsvp] = useState(false);

  const [loadingMoreChamada, setLoadingMoreChamada] = useState(false);
  const [loadingMoreRsvp, setLoadingMoreRsvp] = useState(false);

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [userPool, setUserPool] = useState<TreinoUserDirectoryItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchUser, setSearchUser] = useState("");

  const loadInitial = useCallback(async () => {
    if (!treinoId) return;
    setLoading(true);

    try {
      const [treino, chamadaPage, rsvpPage] = await Promise.all([
        fetchTreinoById(treinoId, { forceRefresh: false }),
        fetchTreinoChamadaPage(treinoId, {
          pageSize: PAGE_SIZE,
          forceRefresh: false,
        }),
        fetchTreinoRsvpsPage(treinoId, {
          pageSize: PAGE_SIZE,
          forceRefresh: false,
        }),
      ]);

      if (treino) {
        setTitulo(treino.modalidade || "Treino");
        setSubtitulo(`${treino.dia || "-"} • ${treino.horario || "-"} • ${treino.local || "-"}`);
      }

      setChamadaRows(chamadaPage.rows);
      setRsvpRows(rsvpPage.rows);
      setChamadaCursor(chamadaPage.nextCursor);
      setRsvpCursor(rsvpPage.nextCursor);
      setHasMoreChamada(chamadaPage.hasMore);
      setHasMoreRsvp(rsvpPage.hasMore);
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao carregar lista de presença.", "error");
    } finally {
      setLoading(false);
    }
  }, [treinoId, addToast]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const inscritosPendentes = useMemo(() => {
    const presentes = new Set(chamadaRows.map((row) => row.userId));
    return rsvpRows.filter((row) => row.status === "going" && !presentes.has(row.userId));
  }, [rsvpRows, chamadaRows]);

  const userSuggestions = useMemo(() => {
    const term = searchUser.trim().toLowerCase();
    if (!term) return [];
    return userPool
      .filter((row) => row.nome.toLowerCase().includes(term))
      .slice(0, 8);
  }, [searchUser, userPool]);

  const handleLoadMoreChamada = async () => {
    if (!treinoId || !hasMoreChamada || !chamadaCursor || loadingMoreChamada) return;
    setLoadingMoreChamada(true);
    try {
      const page = await fetchTreinoChamadaPage(treinoId, {
        pageSize: PAGE_SIZE,
        cursorId: chamadaCursor,
        forceRefresh: false,
      });
      setChamadaRows((prev) => mergeUniqueById(prev, page.rows));
      setChamadaCursor(page.nextCursor);
      setHasMoreChamada(page.hasMore);
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao carregar mais chamada.", "error");
    } finally {
      setLoadingMoreChamada(false);
    }
  };

  const handleLoadMoreRsvp = async () => {
    if (!treinoId || !hasMoreRsvp || !rsvpCursor || loadingMoreRsvp) return;
    setLoadingMoreRsvp(true);
    try {
      const page = await fetchTreinoRsvpsPage(treinoId, {
        pageSize: PAGE_SIZE,
        cursorId: rsvpCursor,
        forceRefresh: false,
      });
      setRsvpRows((prev) => mergeUniqueById(prev, page.rows));
      setRsvpCursor(page.nextCursor);
      setHasMoreRsvp(page.hasMore);
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao carregar mais inscritos.", "error");
    } finally {
      setLoadingMoreRsvp(false);
    }
  };

  const handleTogglePresence = async (row: TreinoChamadaRecord) => {
    if (!treinoId) return;

    const nextStatus = row.status === "presente" ? "falta" : "presente";
    setUpdatingId(row.id);
    try {
      await updateChamadaStatus({
        treinoId,
        chamadaId: row.id,
        status: nextStatus,
      });

      setChamadaRows((prev) =>
        prev.map((entry) =>
          entry.id === row.id ? { ...entry, status: nextStatus } : entry
        )
      );
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao atualizar presença.", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRemoveFromChamada = async (row: TreinoChamadaRecord) => {
    if (!treinoId) return;

    const confirmed = window.confirm("Remover aluno da chamada?");
    if (!confirmed) return;

    setDeletingId(row.id);
    try {
      await deleteChamadaEntry({ treinoId, chamadaId: row.id });
      setChamadaRows((prev) => prev.filter((entry) => entry.id !== row.id));
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao remover aluno.", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const handleConfirmPendingRsvp = async (row: TreinoRsvpRecord) => {
    if (!treinoId) return;

    setUpdatingId(row.userId);
    try {
      await upsertChamadaPresence({
        treinoId,
        userId: row.userId,
        nome: row.userName,
        turma: row.userTurma,
        avatar: row.userAvatar,
        origem: "app",
        status: "presente",
      });

      setChamadaRows((prev) =>
        mergeUniqueById(prev, [
          {
            id: row.userId,
            userId: row.userId,
            nome: row.userName,
            avatar: row.userAvatar,
            turma: row.userTurma,
            status: "presente",
            origem: "app",
          },
        ])
      );
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao confirmar inscrito.", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleLoadUsersPool = async () => {
    if (loadingUsers || userPool.length > 0) return;

    setLoadingUsers(true);
    try {
      const users = await fetchUserDirectory({ maxResults: 80, forceRefresh: false });
      setUserPool(users);
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao carregar base de usuários.", "error");
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleAddUser = async (user: TreinoUserDirectoryItem) => {
    if (!treinoId) return;

    setUpdatingId(user.uid);
    try {
      await addUserToChamada({ treinoId, user });
      setChamadaRows((prev) =>
        mergeUniqueById(prev, [
          {
            id: user.uid,
            userId: user.uid,
            nome: user.nome,
            turma: user.turma,
            avatar: user.foto,
            status: "presente",
            origem: "manual",
          },
        ])
      );
      setSearchUser("");
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao adicionar aluno.", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleExportCsv = () => {
    if (!chamadaRows.length) {
      addToast("Nenhum aluno carregado na chamada.", "info");
      return;
    }

    const headers = ["Nome", "Turma", "Status", "Origem"];
    const rows = chamadaRows.map((row) => [row.nome, row.turma, row.status, row.origem]);

    const csvContent = [headers.join(","), ...rows.map((line) => line.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `chamada_${treinoId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/treinos"
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Lista de Presença</h1>
              <p className="text-[11px] text-zinc-500 font-bold">
                {titulo} • {subtitulo}
              </p>
            </div>
          </div>

          <button
            onClick={handleExportCsv}
            className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 text-xs font-black uppercase flex items-center gap-2"
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </header>

      <main className="px-6 py-6 space-y-5">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="animate-spin text-emerald-500" />
          </div>
        ) : (
          <>
            <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <h2 className="text-xs font-black uppercase text-zinc-400">Adicionar Aluno Manualmente</h2>
                <button
                  onClick={() => void handleLoadUsersPool()}
                  disabled={loadingUsers || userPool.length > 0}
                  className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-200 text-[11px] font-black uppercase disabled:opacity-50"
                >
                  {loadingUsers
                    ? "Carregando base..."
                    : userPool.length > 0
                    ? "Base carregada"
                    : "Carregar 80 usuários"}
                </button>
              </div>

              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={searchUser}
                  onChange={(event) => setSearchUser(event.target.value)}
                  placeholder="Buscar aluno por nome"
                  className="w-full bg-black border border-zinc-700 rounded-xl py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-emerald-500"
                />

                {searchUser.trim() && userSuggestions.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden z-20">
                    {userSuggestions.map((row) => (
                      <button
                        key={row.uid}
                        onClick={() => void handleAddUser(row)}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-zinc-800 flex items-center justify-between"
                      >
                        <span>{row.nome}</span>
                        <UserPlus size={14} className="text-zinc-400" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 text-xs font-black uppercase text-zinc-400">
                Chamada Oficial ({chamadaRows.length} carregados)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-black/40 text-zinc-500 uppercase font-black">
                    <tr>
                      <th className="p-4">Aluno</th>
                      <th className="p-4">Turma</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Origem</th>
                      <th className="p-4 text-right">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-200">
                    {chamadaRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-zinc-500">
                          Nenhum aluno na chamada.
                        </td>
                      </tr>
                    ) : (
                      chamadaRows.map((row) => (
                        <tr key={`${row.id}:${row.userId}`} className="hover:bg-zinc-800/40">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <div className="relative w-7 h-7 rounded-full overflow-hidden border border-zinc-700 bg-zinc-800">
                                <Image
                                  src={row.avatar || "https://github.com/shadcn.png"}
                                  alt={row.nome}
                                  fill
                                  className="object-cover"
                                  unoptimized
                                />
                              </div>
                              <span className="font-bold text-white">{row.nome}</span>
                              <Link
                                href={`/admin/usuarios/${row.userId}`}
                                target="_blank"
                                className="text-zinc-500 hover:text-emerald-400"
                                title="Abrir perfil"
                              >
                                <ExternalLink size={12} />
                              </Link>
                            </div>
                          </td>
                          <td className="p-4">{row.turma || "-"}</td>
                          <td className="p-4 uppercase font-black text-[10px]">{row.status}</td>
                          <td className="p-4 uppercase font-black text-[10px]">{row.origem}</td>
                          <td className="p-4">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => void handleTogglePresence(row)}
                                disabled={updatingId === row.id}
                                className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 disabled:opacity-50"
                                title="Alternar presente/falta"
                              >
                                {updatingId === row.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : row.status === "presente" ? (
                                  <X size={14} className="text-red-400" />
                                ) : (
                                  <CheckCircle size={14} className="text-emerald-400" />
                                )}
                              </button>

                              <button
                                onClick={() => void handleRemoveFromChamada(row)}
                                disabled={deletingId === row.id}
                                className="p-2 rounded-lg bg-red-900/20 border border-red-700/40 text-red-300 disabled:opacity-50"
                                title="Remover da chamada"
                              >
                                {deletingId === row.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Trash2 size={14} />
                                )}
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

            <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 text-xs font-black uppercase text-zinc-400">
                Inscritos no App sem chamada confirmada ({inscritosPendentes.length} carregados)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-black/40 text-zinc-500 uppercase font-black">
                    <tr>
                      <th className="p-4">Aluno</th>
                      <th className="p-4">Turma</th>
                      <th className="p-4">Status RSVP</th>
                      <th className="p-4 text-right">Confirmar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-200">
                    {inscritosPendentes.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-zinc-500">
                          Nenhum inscrito pendente carregado.
                        </td>
                      </tr>
                    ) : (
                      inscritosPendentes.map((row) => (
                        <tr key={row.userId} className="hover:bg-zinc-800/40">
                          <td className="p-4 font-bold text-white">{row.userName}</td>
                          <td className="p-4">{row.userTurma || "-"}</td>
                          <td className="p-4 uppercase font-black text-[10px]">{row.status}</td>
                          <td className="p-4">
                            <div className="flex justify-end">
                              <button
                                onClick={() => void handleConfirmPendingRsvp(row)}
                                disabled={updatingId === row.userId}
                                className="p-2 rounded-lg bg-emerald-600 text-white border border-emerald-500 disabled:opacity-50"
                                title="Confirmar presença"
                              >
                                {updatingId === row.userId ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <CheckCircle size={14} />
                                )}
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => void handleLoadMoreChamada()}
                disabled={!hasMoreChamada || loadingMoreChamada}
                className="py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase tracking-wide hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loadingMoreChamada ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Carregando chamada
                  </>
                ) : (
                  <>
                    <ChevronDown size={15} /> Carregar mais chamada (10)
                  </>
                )}
              </button>

              <button
                onClick={() => void handleLoadMoreRsvp()}
                disabled={!hasMoreRsvp || loadingMoreRsvp}
                className="py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase tracking-wide hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loadingMoreRsvp ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Carregando inscritos
                  </>
                ) : (
                  <>
                    <ChevronDown size={15} /> Carregar mais inscritos (10)
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

