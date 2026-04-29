"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchCollectiveAreaUiConfig,
  getDefaultCollectiveAreaUiConfig,
  saveCollectiveAreaUiConfig,
  type CollectiveAreaKey,
  type CollectiveAreaUiConfig,
} from "@/lib/collectiveAreaUiService";
import {
  deleteLeagueConfig,
  fetchLeagues,
  fetchLeagueUsers,
  saveLeagueConfig,
  type LeagueCategory,
  type LeagueRecord,
  type LeagueUserRecord,
} from "@/lib/leaguesService";
import { resolveLeagueLogoSrc } from "@/lib/leagueMedia";
import { fetchTurmasConfig, type TurmaConfig } from "@/lib/turmasService";
import { withTenantSlug } from "@/lib/tenantRouting";

type CollectiveAdminConfig = {
  area: CollectiveAreaKey;
  category: LeagueCategory;
  title: string;
  singularLabel: string;
  basePath: string;
  adminPath: string;
  syncFromTurmas?: boolean;
};

const AREA_CONFIG: Record<CollectiveAreaKey, CollectiveAdminConfig> = {
  comissoes: {
    area: "comissoes",
    category: "comissao",
    title: "Comissões",
    singularLabel: "Comissão",
    basePath: "/comissoes",
    adminPath: "/admin/comissoes",
    syncFromTurmas: true,
  },
  diretorio: {
    area: "diretorio",
    category: "diretorio",
    title: "Diretório",
    singularLabel: "Página",
    basePath: "/diretorio",
    adminPath: "/admin/diretorio",
  },
};

type RecordDraft = {
  id?: string;
  nome: string;
  sigla: string;
  descricao: string;
  visaoGeral: string;
  bizu: string;
  foto: string;
  visivel: boolean;
  ativa: boolean;
  turmaId: string;
};

const createEmptyDraft = (): RecordDraft => ({
  nome: "",
  sigla: "",
  descricao: "",
  visaoGeral: "",
  bizu: "",
  foto: "",
  visivel: true,
  ativa: true,
  turmaId: "",
});

const getRecordImage = (record?: LeagueRecord | null) =>
  record?.foto?.trim() || resolveLeagueLogoSrc(record, "/placeholder_liga.png");

const buildDraftFromRecord = (record: LeagueRecord): RecordDraft => ({
  id: record.id,
  nome: record.nome || "",
  sigla: record.sigla || "",
  descricao: record.descricao || "",
  visaoGeral: record.visaoGeral || "",
  bizu: record.bizu || "",
  foto: record.foto || resolveLeagueLogoSrc(record) || "",
  visivel: record.visivel !== false,
  ativa: record.ativa !== false,
  turmaId: record.turmaId || "",
});

export function CollectiveAdminPage({ area }: { area: CollectiveAreaKey }) {
  const config = AREA_CONFIG[area];
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const cleanTenantSlug = typeof tenantSlug === "string" ? tenantSlug.trim() : "";

  const [loading, setLoading] = useState(true);
  const [savingArea, setSavingArea] = useState(false);
  const [records, setRecords] = useState<LeagueRecord[]>([]);
  const [users, setUsers] = useState<LeagueUserRecord[]>([]);
  const [turmas, setTurmas] = useState<TurmaConfig[]>([]);
  const [areaConfig, setAreaConfig] = useState<CollectiveAreaUiConfig>(() => getDefaultCollectiveAreaUiConfig(area));
  const [showEditor, setShowEditor] = useState(false);
  const [savingRecord, setSavingRecord] = useState(false);
  const [syncingTurmas, setSyncingTurmas] = useState(false);
  const [draft, setDraft] = useState<RecordDraft>(createEmptyDraft());

  const tenantPath = useCallback(
    (path: string) => (cleanTenantSlug ? withTenantSlug(cleanTenantSlug, path) : path),
    [cleanTenantSlug]
  );

  const syncMissingTurmaCommissions = useCallback(
    async (currentRecords: LeagueRecord[], currentTurmas: TurmaConfig[]) => {
      if (!config.syncFromTurmas || !user?.uid) return false;

      const existingByTurma = new Set(
        currentRecords.map((entry) => (entry.turmaId || "").trim().toUpperCase()).filter(Boolean)
      );
      const visibleTurmas = currentTurmas.filter((entry) => !entry.hidden);
      const missingTurmas = visibleTurmas.filter(
        (entry) => !existingByTurma.has((entry.id || "").trim().toUpperCase())
      );

      if (!missingTurmas.length) {
        return false;
      }

      for (const turma of missingTurmas) {
        await saveLeagueConfig({
          actorUserId: user.uid,
          tenantId: tenantId || undefined,
          data: {
            nome: `Comissão ${turma.nome}`,
            sigla: turma.id,
            descricao: `Página oficial da comissão da ${turma.nome}.`,
            visaoGeral: `Representação da ${turma.nome}.\nMembros oficiais.\nAgenda interna e aberta.\nLoja da comissão.`,
            foto: turma.capa || turma.logo,
            visivel: true,
            ativa: true,
            status: "approved",
            category: "comissao",
            turmaId: turma.id,
          },
        });
      }

      return true;
    },
    [config.syncFromTurmas, tenantId, user?.uid]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [initialRecords, nextAreaConfig, nextUsers, nextTurmas] = await Promise.all([
        fetchLeagues({
          orderByField: "nome",
          orderDirection: "asc",
          maxResults: 180,
          forceRefresh: true,
          tenantId: tenantId || undefined,
          category: config.category,
        }),
        fetchCollectiveAreaUiConfig({
          area,
          tenantId: tenantId || undefined,
        }),
        fetchLeagueUsers({
          maxResults: 220,
          forceRefresh: true,
          tenantId: tenantId || undefined,
        }),
        fetchTurmasConfig({
          tenantId: tenantId || undefined,
          forceRefresh: true,
        }),
      ]);
      let nextRecords = initialRecords;

      const createdMissingCommissions = await syncMissingTurmaCommissions(nextRecords, nextTurmas);
      if (createdMissingCommissions) {
        nextRecords = await fetchLeagues({
          orderByField: "nome",
          orderDirection: "asc",
          maxResults: 180,
          forceRefresh: true,
          tenantId: tenantId || undefined,
          category: config.category,
        });
      }

      setRecords(nextRecords);
      setAreaConfig(nextAreaConfig);
      setUsers(nextUsers);
      setTurmas(nextTurmas);
    } catch (error) {
      console.error(error);
      addToast(`Erro ao carregar ${config.title.toLowerCase()}.`, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, area, config.category, config.title, syncMissingTurmaCommissions, tenantId]);

  useEffect(() => {
    setAreaConfig(getDefaultCollectiveAreaUiConfig(area));
  }, [area]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedManagers = useMemo(
    () =>
      users.filter((entry) => areaConfig.managerUserIds.includes(entry.id)),
    [areaConfig.managerUserIds, users]
  );

  const handleOpenCreate = () => {
    setDraft(createEmptyDraft());
    setShowEditor(true);
  };

  const handleOpenEdit = (record: LeagueRecord) => {
    setDraft(buildDraftFromRecord(record));
    setShowEditor(true);
  };

  const handleDelete = async (record: LeagueRecord) => {
    if (!confirm(`Deseja remover ${record.nome}?`)) return;
    try {
      await deleteLeagueConfig(record.id, { tenantId: tenantId || undefined });
      addToast(`${config.singularLabel} removid${config.singularLabel.endsWith("a") ? "a" : "o"} com sucesso.`, "success");
      await loadData();
    } catch (error) {
      console.error(error);
      addToast("Não consegui remover esse registro agora.", "error");
    }
  };

  const handleSaveAreaConfig = async () => {
    try {
      setSavingArea(true);
      await saveCollectiveAreaUiConfig({
        area,
        config: areaConfig,
        tenantId: tenantId || undefined,
      });
      addToast("Configuração da área salva.", "success");
    } catch (error) {
      console.error(error);
      addToast("Erro ao salvar a configuração da área.", "error");
    } finally {
      setSavingArea(false);
    }
  };

  const handleSaveRecord = async () => {
    if (!draft.nome.trim()) {
      addToast(`Informe o nome d${config.singularLabel.endsWith("a") ? "a" : "o"} ${config.singularLabel.toLowerCase()}.`, "error");
      return;
    }

    try {
      setSavingRecord(true);
      await saveLeagueConfig({
        id: draft.id,
        actorUserId: user?.uid,
        tenantId: tenantId || undefined,
        data: {
          nome: draft.nome,
          sigla: draft.sigla,
          descricao: draft.descricao,
          visaoGeral: draft.visaoGeral,
          bizu: draft.bizu,
          foto: draft.foto,
          visivel: draft.visivel,
          ativa: draft.ativa,
          status: "approved",
          category: config.category,
          turmaId: draft.turmaId || undefined,
        },
      });
      addToast(`${config.singularLabel} salva com sucesso.`, "success");
      setShowEditor(false);
      await loadData();
    } catch (error) {
      console.error(error);
      addToast(`Erro ao salvar ${config.singularLabel.toLowerCase()}.`, "error");
    } finally {
      setSavingRecord(false);
    }
  };

  const handleSyncTurmas = async () => {
    if (!config.syncFromTurmas) return;
    try {
      setSyncingTurmas(true);
      const existingByTurma = new Set(
        records.map((entry) => (entry.turmaId || "").trim().toUpperCase()).filter(Boolean)
      );
      const visibleTurmas = turmas.filter((entry) => !entry.hidden);
      const missingTurmas = visibleTurmas.filter(
        (entry) => !existingByTurma.has((entry.id || "").trim().toUpperCase())
      );
      const created = await syncMissingTurmaCommissions(records, turmas);

      addToast(
        created
          ? `${missingTurmas.length} comissão(ões) criada(s) a partir das turmas.`
          : "Todas as turmas já possuem comissão vinculada.",
        "success"
      );
      await loadData();
    } catch (error) {
      console.error(error);
      addToast("Erro ao sincronizar turmas com as comissões.", "error");
    } finally {
      setSyncingTurmas(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] pb-20 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href={tenantPath("/admin")} className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800">
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">{config.title}</h1>
              <p className="text-[11px] font-bold text-zinc-500">
                Gestão visual, cards publicados e identidade desta área.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {config.syncFromTurmas ? (
              <button
                type="button"
                onClick={() => void handleSyncTurmas()}
                disabled={syncingTurmas || loading}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-brand/30 hover:text-brand-accent disabled:opacity-60"
              >
                {syncingTurmas ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                Sincronizar turmas
              </button>
            ) : null}
            <button type="button" onClick={handleOpenCreate} className="brand-button-solid">
              <Plus size={14} />
              Criar card
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/90 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-white">Configuração da área</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Ajuste o texto público, o nome da barra lateral e o CSS desta página.
              </p>
            </div>
            <button type="button" onClick={() => void handleSaveAreaConfig()} disabled={savingArea} className="brand-button-soft">
              {savingArea ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Salvar área
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Título</label>
              <input value={areaConfig.titulo} onChange={(event) => setAreaConfig((prev) => ({ ...prev, titulo: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Subtítulo</label>
              <input value={areaConfig.subtitulo} onChange={(event) => setAreaConfig((prev) => ({ ...prev, subtitulo: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Rótulo do card</label>
              <input value={areaConfig.rotuloCard} onChange={(event) => setAreaConfig((prev) => ({ ...prev, rotuloCard: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Nome na barra lateral</label>
              <input value={areaConfig.sidebarLabel} onChange={(event) => setAreaConfig((prev) => ({ ...prev, sidebarLabel: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none" />
            </div>
          </div>

          {area === "diretorio" ? (
            <div className="mt-4">
              <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Acesso ao gerenciamento do diretório</label>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {users.map((entry) => {
                  const active = areaConfig.managerUserIds.includes(entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() =>
                        setAreaConfig((prev) => ({
                          ...prev,
                          managerUserIds: active
                            ? prev.managerUserIds.filter((item) => item !== entry.id)
                            : [...prev.managerUserIds, entry.id],
                        }))
                      }
                      className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                        active
                          ? "border-brand/30 bg-brand-soft text-white"
                          : "border-zinc-800 bg-black/30 text-zinc-300 hover:border-zinc-700"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{entry.nome || "Usuário"}</span>
                        <span className="mt-1 block text-[11px] text-zinc-500">{entry.turma || "Sem turma"}</span>
                      </span>
                      <Users size={14} className={active ? "text-brand-accent" : "text-zinc-600"} />
                    </button>
                  );
                })}
              </div>
              {selectedManagers.length > 0 ? (
                <p className="mt-3 text-xs text-zinc-500">
                  Acesso liberado para: {selectedManagers.map((entry) => entry.nome || entry.id).join(", ")}.
                </p>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">Nenhum membro extra foi liberado para gerenciar o diretório.</p>
              )}
            </div>
          ) : null}

          <div className="mt-4">
            <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">CSS customizado</label>
            <textarea
              rows={8}
              value={areaConfig.customCss}
              onChange={(event) => setAreaConfig((prev) => ({ ...prev, customCss: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none"
              placeholder=".minha-area { color: white; }"
            />
          </div>
        </section>

        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/90 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-white">Cards publicados</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Use esses registros para alimentar a página pública, seus membros, agenda e loja.
              </p>
            </div>
            <Link href={tenantPath(config.basePath)} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-xs font-black uppercase text-zinc-200 transition hover:border-brand/30 hover:text-brand-accent">
              <ExternalLink size={14} />
              Ver página pública
            </Link>
          </div>

          {loading ? (
            <div className="mt-6 flex min-h-[220px] items-center justify-center rounded-[1.6rem] border border-zinc-800 bg-black/20">
              <Loader2 size={22} className="animate-spin text-brand" />
            </div>
          ) : records.length === 0 ? (
            <div className="mt-6 rounded-[1.6rem] border border-dashed border-zinc-800 bg-black/20 p-10 text-center">
              <p className="text-sm text-zinc-500">Nenhum card foi criado ainda.</p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {records.map((record) => (
                <article key={record.id} className="overflow-hidden rounded-[1.8rem] border border-white/10 bg-black/30">
                  <div className="relative h-44 w-full">
                    <Image src={getRecordImage(record)} alt={record.nome} fill sizes="360px" className="object-cover" />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0.78))]" />
                    <div className="absolute inset-x-4 bottom-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-accent">{record.turmaId || areaConfig.rotuloCard}</p>
                      <h3 className="mt-2 text-xl font-black text-white">{record.nome}</h3>
                    </div>
                  </div>

                  <div className="space-y-4 p-5">
                    <p className="text-sm leading-6 text-zinc-300">
                      {record.descricao || "Sem descrição publicada ainda."}
                    </p>

                    <div className="flex flex-wrap gap-2 text-[11px] font-bold text-zinc-400">
                      <span className="rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                        {record.visivel !== false ? "Publicado" : "Oculto"}
                      </span>
                      <span className="rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                        {record.membersCount ?? record.membros?.length ?? 0} membros
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <Link href={tenantPath(`${config.basePath}/${record.id}`)} className="brand-button-soft flex-1 justify-center">
                        Abrir
                      </Link>
                      <button type="button" onClick={() => handleOpenEdit(record)} className="inline-flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 px-4 text-zinc-300 transition hover:border-brand/30 hover:text-brand-accent">
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => void handleDelete(record)} className="inline-flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 px-4 text-zinc-300 transition hover:border-red-500/30 hover:text-red-300">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {showEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[2rem] border border-zinc-800 bg-[#050505] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-white">{draft.id ? "Editar card" : "Criar card"}</h2>
                <p className="mt-1 text-sm text-zinc-500">Preencha os dados básicos publicados nesta área.</p>
              </div>
              <button type="button" onClick={() => setShowEditor(false)} className="rounded-full border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Nome</label>
                <input value={draft.nome} onChange={(event) => setDraft((prev) => ({ ...prev, nome: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none" />
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Sigla</label>
                <input value={draft.sigla} onChange={(event) => setDraft((prev) => ({ ...prev, sigla: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none" />
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Descrição</label>
                <textarea rows={3} value={draft.descricao} onChange={(event) => setDraft((prev) => ({ ...prev, descricao: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none" />
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Visão geral</label>
                <textarea rows={5} value={draft.visaoGeral} onChange={(event) => setDraft((prev) => ({ ...prev, visaoGeral: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none" />
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Bizu</label>
                <input value={draft.bizu} onChange={(event) => setDraft((prev) => ({ ...prev, bizu: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none" />
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Imagem (URL)</label>
                <input value={draft.foto} onChange={(event) => setDraft((prev) => ({ ...prev, foto: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none" />
              </div>
              {area === "comissoes" ? (
                <div>
                  <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Turma vinculada</label>
                  <select value={draft.turmaId} onChange={(event) => setDraft((prev) => ({ ...prev, turmaId: event.target.value }))} className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none">
                    <option value="">Selecionar turma</option>
                    {turmas.filter((entry) => !entry.hidden).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.id} - {entry.nome}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
                  <input type="checkbox" checked={draft.visivel} onChange={(event) => setDraft((prev) => ({ ...prev, visivel: event.target.checked }))} />
                  Publicado
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
                  <input type="checkbox" checked={draft.ativa} onChange={(event) => setDraft((prev) => ({ ...prev, ativa: event.target.checked }))} />
                  Ativo
                </label>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setShowEditor(false)} className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs font-black uppercase text-zinc-300">
                Cancelar
              </button>
              <button type="button" onClick={() => void handleSaveRecord()} disabled={savingRecord} className="brand-button-solid">
                {savingRecord ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar card
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
