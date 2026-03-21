"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Loader2,
  Power,
  Search,
  ShieldCheck,
  ExternalLink,
  Pencil,
  Save,
  X,
} from "lucide-react";

import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import { useToast } from "@/context/ToastContext";
import {
  fetchAdminPartnersPage,
  setPartnerStatus,
  upsertPartner,
  uploadPartnerImageToStorage,
  type PartnerRecord,
  type PartnerStatus,
  type PartnerTier,
} from "@/lib/partnersService";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";
import {
  EMAIL_MAX_LENGTH,
  hasValidPhoneLength,
  isValidEmail,
  normalizeEmailInput,
  normalizePhoneInput,
  PHONE_MAX_LENGTH,
} from "@/utils/contactFields";

const PAGE_SIZE = 20;

type StatusFilter = PartnerStatus | "all";

const mergeUniquePartners = (
  current: PartnerRecord[],
  next: PartnerRecord[]
): PartnerRecord[] => {
  if (!next.length) return current;

  const ids = new Set(current.map((row) => row.id));
  const merged = [...current];

  next.forEach((row) => {
    if (ids.has(row.id)) return;
    ids.add(row.id);
    merged.push(row);
  });

  return merged;
};

const statusLabel: Record<PartnerStatus, string> = {
  active: "Ativo",
  pending: "Pendente",
  disabled: "Desativado",
};

const statusClass: Record<PartnerStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  pending: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
  disabled: "bg-red-500/10 text-red-300 border-red-500/30",
};

export default function AdminParceirosEmpresasPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const pathInfo = useMemo(() => parseTenantScopedPath(pathname || ""), [pathname]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<PartnerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [editingPartner, setEditingPartner] = useState<PartnerRecord | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<PartnerRecord>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [uploadingImageField, setUploadingImageField] = useState<
    "imgLogo" | "imgCapa" | null
  >(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const backHref = pathInfo.tenantSlug
    ? withTenantSlug(pathInfo.tenantSlug, "/admin/parceiros")
    : "/admin/parceiros";

  const loadRows = useCallback(
    async (options?: { reset?: boolean; cursorId?: string | null }) => {
      const reset = options?.reset ?? false;
      const cursorId = options?.cursorId ?? null;

      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        const page = await fetchAdminPartnersPage({
          pageSize: PAGE_SIZE,
          cursorId: reset ? null : cursorId,
          status: statusFilter,
          forceRefresh: false,
        });

        if (reset) setRows(page.partners);
        else setRows((prev) => mergeUniquePartners(prev, page.partners));

        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar empresas.", "error");
      } finally {
        if (reset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [addToast, statusFilter]
  );

  useEffect(() => {
    void loadRows({ reset: true });
  }, [loadRows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;

    return rows.filter((row) =>
      `${row.nome} ${row.categoria} ${row.email} ${row.responsavel}`
        .toLowerCase()
        .includes(term)
    );
  }, [rows, search]);

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    await loadRows({ reset: false, cursorId: nextCursor });
  };

  const handleToggleStatus = async (row: PartnerRecord) => {
    const nextStatus: PartnerStatus =
      row.status === "active" ? "disabled" : "active";

    try {
      await setPartnerStatus({ partnerId: row.id, status: nextStatus });
      setRows((prev) =>
        prev.map((entry) =>
          entry.id === row.id ? { ...entry, status: nextStatus } : entry
        )
      );
      addToast("Status atualizado.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar status.", "error");
    }
  };

  const openEditModal = (row: PartnerRecord) => {
    setCreateMode(false);
    setEditingPartner(row);
    setEditForm({ ...row });
  };

  const openCreateModal = useCallback(() => {
    setCreateMode(true);
    setEditingPartner(null);
    setEditForm({
      nome: "",
      categoria: "",
      tier: "standard",
      status: "active",
      cnpj: "",
      responsavel: "",
      email: "",
      telefone: "",
      descricao: "",
      endereco: "",
      horario: "",
      insta: "",
      site: "",
      whats: "",
      imgLogo: "",
      imgCapa: "",
    });
  }, []);

  const closeEditModal = () => {
    setCreateMode(false);
    setEditingPartner(null);
    setEditForm({});
    setSavingEdit(false);
    setUploadingImageField(null);
  };

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    openCreateModal();
    router.replace(pathname || "/admin/parceiros/empresas", { scroll: false });
  }, [openCreateModal, pathname, router, searchParams]);

  const handleEditChange = (field: keyof PartnerRecord, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleUploadImage = async (
    event: React.ChangeEvent<HTMLInputElement>,
    field: "imgLogo" | "imgCapa"
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || uploadingImageField !== null) {
      input.value = "";
      return;
    }

    try {
      setUploadingImageField(field);
      const imageUrl = await uploadPartnerImageToStorage({
        file,
        kind: field === "imgCapa" ? "capa" : "logo",
        partnerId: editingPartner?.id,
      });
      setEditForm((prev) => ({ ...prev, [field]: imageUrl }));
      addToast(
        field === "imgLogo" ? "Logo enviada com sucesso." : "Capa enviada com sucesso.",
        "success"
      );
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao enviar imagem do parceiro.", "error");
    } finally {
      setUploadingImageField(null);
      input.value = "";
    }
  };

  const handleSaveEdit = async () => {
    if (!createMode && !editingPartner) return;

    const nome = String(editForm.nome || "").trim();
    const email = String(editForm.email || "").trim();
    const telefone = String(editForm.telefone || "").trim();
    const whats = String(editForm.whats || "").trim();
    if (!nome) {
      addToast("Nome do parceiro e obrigatorio.", "error");
      return;
    }
    if (email && !isValidEmail(email)) {
      addToast("Informe um email valido para o parceiro.", "error");
      return;
    }
    if (telefone && !hasValidPhoneLength(telefone)) {
      addToast("Informe um telefone valido para o parceiro.", "error");
      return;
    }
    if (whats && !hasValidPhoneLength(whats)) {
      addToast("Informe um WhatsApp valido para o parceiro.", "error");
      return;
    }

    try {
      setSavingEdit(true);
      const updated = await upsertPartner({
        partnerId: createMode ? undefined : editingPartner?.id,
        data: {
          nome,
          categoria: String(editForm.categoria || "").trim(),
          tier: String(editForm.tier || editingPartner?.tier || "standard") as PartnerTier,
          status: String(editForm.status || editingPartner?.status || "active") as PartnerStatus,
          cnpj: String(editForm.cnpj || "").trim(),
          responsavel: String(editForm.responsavel || "").trim(),
          email,
          telefone,
          descricao: String(editForm.descricao || "").trim(),
          endereco: String(editForm.endereco || "").trim(),
          horario: String(editForm.horario || "").trim(),
          insta: String(editForm.insta || "").trim(),
          site: String(editForm.site || "").trim(),
          whats,
          imgLogo: String(editForm.imgLogo || "").trim(),
          imgCapa: String(editForm.imgCapa || "").trim(),
        },
      });

      if (updated) {
        setRows((prev) => {
          const existingIndex = prev.findIndex((entry) => entry.id === updated.id);
          if (existingIndex >= 0) {
            return prev.map((entry) =>
              entry.id === updated.id ? { ...entry, ...updated } : entry
            );
          }
          return [updated, ...prev];
        });
      }

      addToast(createMode ? "Parceiro criado." : "Parceiro atualizado.", "success");
      closeEditModal();
    } catch (error: unknown) {
      console.error(error);
      addToast(
        createMode ? "Erro ao criar parceiro." : "Erro ao salvar parceiro.",
        "error"
      );
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link
            href={backHref}
            className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          >
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Empresas Parceiras</h1>
            <p className="text-[11px] text-zinc-500 font-bold">
              Lista paginada (20 por leitura). Nao carrega tudo de uma vez.
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 space-y-4">
        <section className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="w-full md:max-w-2xl flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar empresa"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-3 text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand bg-brand-primary/10 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-brand hover:bg-brand-primary/15 whitespace-nowrap"
              title="Criar parceiro"
            >
              <Plus size={14} />
              Criar Parceiro
            </button>
          </div>

          <div className="flex gap-2">
            {[
              { id: "all", label: "Todos" },
              { id: "active", label: "Ativos" },
              { id: "pending", label: "Pendentes" },
              { id: "disabled", label: "Desativados" },
            ].map((option) => (
              <button
                key={option.id}
                onClick={() => setStatusFilter(option.id as StatusFilter)}
                className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase border transition ${
                  statusFilter === option.id
                    ? "bg-white text-black border-white"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white"
                }`}
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
                  <th className="p-4">Empresa</th>
                  <th className="p-4">Categoria</th>
                  <th className="p-4">Plano</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Scans</th>
                  <th className="p-4 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center">
                      <Loader2 className="animate-spin mx-auto text-emerald-500" />
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-zinc-500">
                      Nenhuma empresa encontrada.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-800/40">
                      <td className="p-4">
                        <p className="font-bold text-white">{row.nome}</p>
                        <p className="text-zinc-500">{row.email || "-"}</p>
                      </td>
                      <td className="p-4">{row.categoria || "-"}</td>
                      <td className="p-4 uppercase font-black">{row.tier}</td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-1 rounded border text-[10px] uppercase font-black ${statusClass[row.status]}`}
                        >
                          {statusLabel[row.status]}
                        </span>
                      </td>
                      <td className="p-4">{row.totalScans || 0}</td>
                      <td className="p-4">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={
                              pathInfo.tenantSlug
                                ? withTenantSlug(pathInfo.tenantSlug, `/empresa/${row.id}`)
                                : `/empresa/${row.id}`
                            }
                            target="_blank"
                            className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                            title="Abrir pagina da empresa"
                          >
                            <ExternalLink size={15} />
                          </Link>
                          <button
                            onClick={() => openEditModal(row)}
                            className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                            title="Editar parceiro"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => void handleToggleStatus(row)}
                            className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                            title="Alternar status"
                          >
                            {row.status === "disabled" ? (
                              <ShieldCheck size={15} />
                            ) : (
                              <Power size={15} />
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

        {(editingPartner || createMode) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
            <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
              <div className="mb-5 flex items-center justify-between gap-3 border-b border-zinc-800 pb-4">
                <div>
                  <h2 className="text-lg font-black uppercase tracking-tight text-white">
                    {createMode ? "Criar Parceiro" : "Editar Parceiro"}
                  </h2>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                    {createMode
                      ? "Cadastro completo da empresa parceira"
                      : "Campos de cadastro, pagina publica e painel da empresa"}
                  </p>
                </div>
                <button
                  onClick={closeEditModal}
                  className="rounded-full border border-zinc-700 bg-zinc-900 p-2 text-zinc-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-zinc-800 bg-black/30 p-4 md:col-span-2">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                        Logo do parceiro
                      </p>
                      <div className="relative aspect-square w-full max-w-[180px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                        {String(editForm.imgLogo || "").trim() ? (
                          <Image
                            src={String(editForm.imgLogo)}
                            alt="Logo do parceiro"
                            fill
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[11px] font-bold uppercase text-zinc-500">
                            Sem logo
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        disabled={uploadingImageField !== null}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand bg-brand-primary/10 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-brand hover:bg-brand-primary/15 disabled:opacity-60"
                      >
                        {uploadingImageField === "imgLogo" ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Plus size={14} />
                        )}
                        {uploadingImageField === "imgLogo" ? "Enviando..." : "Adicionar logo"}
                      </button>
                      <input
                        ref={logoInputRef}
                        type="file"
                        hidden
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => void handleUploadImage(event, "imgLogo")}
                      />
                      <ImageResizeHelpLink label="Diminuir a logo no favicon.io/favicon-converter" />
                    </div>

                    <div className="space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                        Capa do parceiro
                      </p>
                      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                        {String(editForm.imgCapa || "").trim() ? (
                          <Image
                            src={String(editForm.imgCapa)}
                            alt="Capa do parceiro"
                            fill
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[11px] font-bold uppercase text-zinc-500">
                            Sem capa
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        disabled={uploadingImageField !== null}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand bg-brand-primary/10 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-brand hover:bg-brand-primary/15 disabled:opacity-60"
                      >
                        {uploadingImageField === "imgCapa" ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Plus size={14} />
                        )}
                        {uploadingImageField === "imgCapa" ? "Enviando..." : "Adicionar capa"}
                      </button>
                      <input
                        ref={coverInputRef}
                        type="file"
                        hidden
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => void handleUploadImage(event, "imgCapa")}
                      />
                      <ImageResizeHelpLink label="Diminuir a capa no favicon.io/favicon-converter" />
                    </div>
                  </div>

                  <p className="mt-4 text-[11px] text-zinc-500">
                    Restricoes automáticas: logo até 2MB, capa até 3MB, formatos PNG/JPG/WEBP.
                    O upload já reduz peso e resolução para segurar storage, egress e leitura.
                  </p>
                </div>

                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Nome</span>
                  <input value={String(editForm.nome || "")} onChange={(event) => handleEditChange("nome", event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Categoria</span>
                  <input value={String(editForm.categoria || "")} onChange={(event) => handleEditChange("categoria", event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Plano</span>
                  <select value={String(editForm.tier || editingPartner?.tier || "standard")} onChange={(event) => handleEditChange("tier", event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand">
                    <option value="ouro">Ouro</option>
                    <option value="prata">Prata</option>
                    <option value="standard">Standard</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Status</span>
                  <select value={String(editForm.status || editingPartner?.status || "active")} onChange={(event) => handleEditChange("status", event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand">
                    <option value="active">Ativo</option>
                    <option value="pending">Pendente</option>
                    <option value="disabled">Desativado</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Responsavel</span>
                  <input value={String(editForm.responsavel || "")} onChange={(event) => handleEditChange("responsavel", event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">CNPJ</span>
                  <input value={String(editForm.cnpj || "")} onChange={(event) => handleEditChange("cnpj", event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">E-mail</span>
                  <input type="email" maxLength={EMAIL_MAX_LENGTH} value={String(editForm.email || "")} onChange={(event) => handleEditChange("email", normalizeEmailInput(event.target.value))} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Telefone</span>
                  <input maxLength={PHONE_MAX_LENGTH} inputMode="numeric" value={String(editForm.telefone || "")} onChange={(event) => handleEditChange("telefone", normalizePhoneInput(event.target.value))} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Descricao</span>
                  <textarea value={String(editForm.descricao || "")} onChange={(event) => handleEditChange("descricao", event.target.value)} rows={3} className="w-full resize-none rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Endereco</span>
                  <input value={String(editForm.endereco || "")} onChange={(event) => handleEditChange("endereco", event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Horario</span>
                  <input value={String(editForm.horario || "")} onChange={(event) => handleEditChange("horario", event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Instagram</span>
                  <input value={String(editForm.insta || "")} onChange={(event) => handleEditChange("insta", event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">WhatsApp</span>
                  <input maxLength={PHONE_MAX_LENGTH} inputMode="numeric" value={String(editForm.whats || "")} onChange={(event) => handleEditChange("whats", normalizePhoneInput(event.target.value))} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Site</span>
                  <input value={String(editForm.site || "")} onChange={(event) => handleEditChange("site", event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand" />
                </label>
                <div className="rounded-xl border border-zinc-800 bg-black/30 px-4 py-3 text-[11px] text-zinc-500 md:col-span-2">
                  Logo e capa agora sao enviados pelo botao de upload acima para evitar erro manual de URL.
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button onClick={closeEditModal} className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-zinc-300 hover:bg-zinc-800">
                  Cancelar
                </button>
                <button onClick={() => void handleSaveEdit()} disabled={savingEdit} className="inline-flex items-center gap-2 rounded-xl border border-brand bg-brand-primary/10 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-brand hover:bg-brand-primary/15 disabled:opacity-60">
                  {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {savingEdit
                    ? createMode
                      ? "Criando"
                      : "Salvando"
                    : createMode
                      ? "Criar parceiro"
                      : "Salvar parceiro"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
