"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Save,
  Search,
  Settings2,
  Upload,
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
} from "@/lib/collectiveAreaUiService";
import {
  fetchLeagueUsers,
  fetchPrimaryLeagueRecord,
  saveLeagueConfig,
  uploadLeagueImageToStorage,
  type LeagueRecord,
  type LeagueUserRecord,
} from "@/lib/leaguesService";
import { resolveLeagueLogoSrc } from "@/lib/leagueMedia";
import { withTenantSlug } from "@/lib/tenantRouting";

type DirectoryDraft = {
  id?: string;
  nome: string;
  sigla: string;
  foto: string;
};

const DEFAULT_DIRECTORY_DESCRIPTION =
  "Página oficial do diretório com gestão, membros, agenda, loja e identidade visual.";

const DEFAULT_DIRECTORY_OVERVIEW = [
  "Gestão institucional do diretório.",
  "Equipe oficial publicada para a comunidade.",
  "Agenda acadêmica, eventos e loja centralizados.",
].join("\n");

const buildDraft = (record: LeagueRecord | null): DirectoryDraft => ({
  id: record?.id,
  nome: record?.nome || "Diretório",
  sigla: record?.sigla || "DIR",
  foto: record?.foto || resolveLeagueLogoSrc(record) || "",
});

export function DirectoryAdminPage() {
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const cleanTenantSlug = typeof tenantSlug === "string" ? tenantSlug.trim() : "";
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [record, setRecord] = useState<LeagueRecord | null>(null);
  const [draft, setDraft] = useState<DirectoryDraft>(() => buildDraft(null));
  const [users, setUsers] = useState<LeagueUserRecord[]>([]);
  const [areaConfig, setAreaConfig] = useState(() => getDefaultCollectiveAreaUiConfig("diretorio"));
  const [managerIds, setManagerIds] = useState<string[]>([]);

  const tenantPath = useCallback(
    (path: string) => (cleanTenantSlug ? withTenantSlug(cleanTenantSlug, path) : path),
    [cleanTenantSlug]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [directoryRecord, areaConfig, tenantUsers] = await Promise.all([
        fetchPrimaryLeagueRecord({
          forceRefresh: true,
          tenantId: tenantId || undefined,
          category: "diretorio",
        }),
        fetchCollectiveAreaUiConfig({
          area: "diretorio",
          tenantId: tenantId || undefined,
        }).catch(() => getDefaultCollectiveAreaUiConfig("diretorio")),
        fetchLeagueUsers({
          maxResults: 280,
          forceRefresh: true,
          tenantId: tenantId || undefined,
        }),
      ]);

      const nextManagerIds = Array.from(
        new Set([
          ...(directoryRecord?.managerUserIds || []),
          ...(areaConfig.managerUserIds || []),
        ].map((entry) => String(entry || "").trim()).filter(Boolean))
      );

      setRecord(directoryRecord);
      setDraft(buildDraft(directoryRecord));
      setUsers(tenantUsers);
      setAreaConfig(areaConfig);
      setManagerIds(nextManagerIds);
    } catch (error) {
      console.error(error);
      addToast("Erro ao carregar a configuração do diretório.", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedManagers = useMemo(
    () => managerIds.map((id) => users.find((entry) => entry.id === id)).filter((entry): entry is LeagueUserRecord => Boolean(entry)),
    [managerIds, users]
  );

  const availableUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users
      .filter((entry) => !managerIds.includes(entry.id))
      .filter((entry) => {
        if (!term) return false;
        const name = String(entry.nome || "").toLowerCase();
        const turma = String(entry.turma || "").toLowerCase();
        return name.includes(term) || turma.includes(term) || entry.id.toLowerCase().includes(term);
      })
      .slice(0, 8);
  }, [managerIds, search, users]);

  const handleUpload = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadLeagueImageToStorage({
        file,
        kind: "logo",
        leagueId: record?.id || "diretorio-temp",
        entityId: "identidade",
      });
      setDraft((current) => ({ ...current, foto: url }));
      addToast("Logo enviada. Salve para publicar a alteração.", "success");
    } catch (error) {
      console.error(error);
      addToast("Não consegui enviar o logo agora.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    const nome = draft.nome.trim();
    const sigla = draft.sigla.trim().toUpperCase();
    if (!nome) {
      addToast("Informe o nome do diretório.", "error");
      return;
    }

    try {
      setSaving(true);
      const result = await saveLeagueConfig({
        id: record?.id,
        actorUserId: user?.uid,
        tenantId: tenantId || undefined,
        data: {
          nome,
          sigla,
          foto: draft.foto.trim(),
          descricao: record?.descricao || DEFAULT_DIRECTORY_DESCRIPTION,
          visaoGeral: record?.visaoGeral || DEFAULT_DIRECTORY_OVERVIEW,
          bizu: record?.bizu || "",
          visivel: true,
          ativa: true,
          status: "approved",
          category: "diretorio",
          managerUserIds: managerIds,
          membros: record?.membros || [],
          eventos: record?.eventos || [],
          links: record?.links || [],
          paymentConfig: record?.paymentConfig || null,
          memberRequests: record?.memberRequests || [],
        },
      });

      await saveCollectiveAreaUiConfig({
        area: "diretorio",
        tenantId: tenantId || undefined,
        config: {
          ...areaConfig,
          customCss: "",
          managerUserIds: managerIds,
        },
      });

      addToast("Diretório atualizado com sucesso.", "success");
      setRecord((current) => ({
        ...(current || {}),
        id: result.id,
        nome,
        sigla,
        foto: draft.foto.trim(),
        category: "diretorio",
        managerUserIds: managerIds,
      } as LeagueRecord));
      await load();
    } catch (error) {
      console.error(error);
      addToast("Erro ao salvar o diretório.", "error");
    } finally {
      setSaving(false);
    }
  };

  const previewImage = draft.foto || resolveLeagueLogoSrc(record) || "/placeholder_liga.png";

  return (
    <div className="min-h-screen bg-[#050505] pb-24 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href={tenantPath("/admin")} className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800">
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Diretório</h1>
              <p className="text-[11px] font-bold text-zinc-500">
                Identidade pública e acesso à gestão do diretório.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={tenantPath("/diretorio")}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-xs font-black uppercase text-zinc-200 transition hover:border-brand/30 hover:text-brand-accent"
            >
              Ver página
            </Link>
            <Link
              href={tenantPath("/diretorio/configurar")}
              className="inline-flex items-center gap-2 rounded-2xl border border-brand/30 bg-brand-soft px-4 py-3 text-xs font-black uppercase text-brand-accent transition hover:opacity-90"
            >
              <Settings2 size={14} />
              Abrir gestão
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {loading ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-[2rem] border border-zinc-800 bg-zinc-950/80">
            <Loader2 size={22} className="animate-spin text-brand" />
          </div>
        ) : (
          <>
            <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/90 p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Identidade</p>
                    <h2 className="mt-2 text-2xl font-black text-white">Nome, sigla e logo</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving || uploading}
                    className="inline-flex items-center gap-2 rounded-2xl border border-brand/30 bg-brand-soft px-4 py-3 text-xs font-black uppercase text-brand-accent disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Salvar
                  </button>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-[132px_1fr]">
                  <div className="space-y-3">
                    <div className="relative h-32 w-32 overflow-hidden rounded-[1.75rem] border border-zinc-800 bg-black/40">
                      <Image src={previewImage} alt={draft.nome || "Diretório"} fill sizes="128px" className="object-cover" />
                    </div>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        event.target.value = "";
                        void handleUpload(file);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={uploading || saving}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs font-black uppercase text-blue-300 disabled:opacity-60"
                    >
                      {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      Adicionar logo
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Nome do diretório</label>
                      <input
                        value={draft.nome}
                        onChange={(event) => setDraft((current) => ({ ...current, nome: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Sigla</label>
                      <input
                        value={draft.sigla}
                        onChange={(event) => setDraft((current) => ({ ...current, sigla: event.target.value.toUpperCase() }))}
                        className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none uppercase"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">URL do logo</label>
                      <input
                        value={draft.foto}
                        onChange={(event) => setDraft((current) => ({ ...current, foto: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/90 p-6">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Resumo</p>
                <div className="mt-4 space-y-4">
                  <div className="rounded-[1.5rem] border border-white/10 bg-black/30 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Gestores liberados</p>
                    <p className="mt-2 text-3xl font-black text-white">{managerIds.length}</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-white/10 bg-black/30 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Página vinculada</p>
                    <p className="mt-2 text-lg font-black text-white">{record?.id ? "Configurada" : "Ainda não criada"}</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/90 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Gestão</p>
                  <h2 className="mt-2 text-2xl font-black text-white">Pesquisar e adicionar membros</h2>
                </div>
                <div className="relative w-full max-w-md">
                  <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar por nome, turma ou ID"
                    className="w-full rounded-2xl border border-zinc-800 bg-black/30 py-3 pl-11 pr-4 text-sm outline-none"
                  />
                </div>
              </div>

              {selectedManagers.length > 0 ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  {selectedManagers.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 rounded-2xl border border-brand/30 bg-brand-soft px-4 py-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-brand/30 bg-black/20 text-brand-accent">
                        <Users size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">{entry.nome || "Usuário"}</p>
                        <p className="text-[11px] text-zinc-300">{entry.turma || "Sem turma"}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setManagerIds((current) => current.filter((id) => id !== entry.id))}
                        className="rounded-full border border-white/10 bg-black/20 p-2 text-zinc-300 hover:text-white"
                        aria-label={`Remover ${entry.nome || entry.id}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-6 rounded-[1.5rem] border border-dashed border-zinc-800 bg-black/20 p-6 text-sm text-zinc-500">
                  Nenhum gestor adicional foi selecionado ainda.
                </p>
              )}

              {search.trim() ? (
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  {availableUsers.length > 0 ? (
                    availableUsers.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          setManagerIds((current) => Array.from(new Set([...current, entry.id])));
                          setSearch("");
                        }}
                        className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-black/30 px-4 py-4 text-left transition hover:border-brand/30 hover:bg-zinc-900"
                      >
                        <span>
                          <span className="block text-sm font-black text-white">{entry.nome || "Usuário"}</span>
                          <span className="mt-1 block text-[11px] text-zinc-500">{entry.turma || "Sem turma"}</span>
                        </span>
                        <span className="rounded-full border border-brand/30 bg-brand-soft px-3 py-2 text-[10px] font-black uppercase text-brand-accent">
                          Adicionar
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="rounded-[1.5rem] border border-dashed border-zinc-800 bg-black/20 p-6 text-sm text-zinc-500 md:col-span-2">
                      Nenhum usuário encontrado para esse termo.
                    </p>
                  )}
                </div>
              ) : null}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
