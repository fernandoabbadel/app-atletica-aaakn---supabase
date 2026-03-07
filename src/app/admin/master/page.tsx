"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Blocks,
  Loader2,
  Palette,
  Pencil,
  RefreshCw,
  Rocket,
  Save,
  Shield,
  Slash,
  ToggleLeft,
  ToggleRight,
  Upload,
  X,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchManageableTenants,
  updateTenantProfile,
  updateTenantStatus,
  uploadTenantLogo,
  type TenantSummary,
} from "@/lib/tenantService";
import { isPlatformMaster } from "@/lib/roles";

const statusBadgeClass: Record<TenantSummary["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  inactive: "bg-zinc-600/20 text-zinc-300 border-zinc-500/40",
  blocked: "bg-red-500/20 text-red-300 border-red-500/30",
};

const AREA_OPTIONS = [
  { value: "", label: "Selecione a area" },
  { value: "exatas", label: "Exatas" },
  { value: "humanas", label: "Humanas" },
  { value: "biologicas", label: "Biologicas" },
  { value: "saude", label: "Saude" },
  { value: "outras", label: "Outras" },
];

type TenantEditForm = {
  nome: string;
  sigla: string;
  faculdade: string;
  cidade: string;
  curso: string;
  area: string;
  cnpj: string;
  contatoEmail: string;
  contatoTelefone: string;
  logoUrl: string;
  paletteKey: TenantSummary["paletteKey"];
  allowPublicSignup: boolean;
  status: TenantSummary["status"];
};

const buildFormFromTenant = (tenant: TenantSummary): TenantEditForm => ({
  nome: tenant.nome,
  sigla: tenant.sigla,
  faculdade: tenant.faculdade,
  cidade: tenant.cidade,
  curso: tenant.curso,
  area: tenant.area,
  cnpj: tenant.cnpj,
  contatoEmail: tenant.contatoEmail,
  contatoTelefone: tenant.contatoTelefone,
  logoUrl: tenant.logoUrl,
  paletteKey: tenant.paletteKey,
  allowPublicSignup: tenant.allowPublicSignup,
  status: tenant.status,
});

export default function AdminMasterPage() {
  const { user, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const {
    tenantId: activeTenantId,
    isOverrideActive,
    setMasterTenantOverride,
    refreshTenantTheme,
  } = useTenantTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingTenantId, setSavingTenantId] = useState("");
  const [tenants, setTenants] = useState<TenantSummary[]>([]);

  const [editingTenantId, setEditingTenantId] = useState("");
  const [editForm, setEditForm] = useState<TenantEditForm | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const canAccess = isPlatformMaster(user);

  const sortedTenants = useMemo(
    () => [...tenants].sort((a, b) => a.nome.localeCompare(b.nome)),
    [tenants]
  );

  const loadTenants = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);

      try {
        const rows = await fetchManageableTenants({ includeAll: true });
        setTenants(rows);
      } catch (error: unknown) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Falha ao carregar tenants.";
        addToast(message, "error");
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [addToast]
  );

  useEffect(() => {
    if (authLoading) return;
    if (!canAccess) {
      setLoading(false);
      router.replace("/sem-permissao");
      return;
    }
    void loadTenants("initial");
  }, [authLoading, canAccess, loadTenants, router]);

  const handleSetTenantContext = (tenant: TenantSummary) => {
    setMasterTenantOverride(tenant.id);
    addToast(`Contexto admin ativo em ${tenant.sigla}.`, "success");
    router.push("/admin");
  };

  const handleClearContext = () => {
    setMasterTenantOverride("");
    addToast("Contexto tenant removido. Voltando para modo global.", "success");
  };

  const handleTenantStatus = async (
    tenantId: string,
    status: TenantSummary["status"]
  ) => {
    try {
      setSavingTenantId(tenantId);
      await updateTenantStatus({ tenantId, status });
      setTenants((prev) =>
        prev.map((tenant) =>
          tenant.id === tenantId ? { ...tenant, status } : tenant
        )
      );
      addToast(`Status do tenant atualizado para ${status}.`, "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao atualizar status.";
      addToast(message, "error");
    } finally {
      setSavingTenantId("");
    }
  };

  const startEditTenant = (tenant: TenantSummary) => {
    setEditingTenantId(tenant.id);
    setEditForm(buildFormFromTenant(tenant));
  };

  const cancelEditTenant = () => {
    setEditingTenantId("");
    setEditForm(null);
  };

  const handleLogoUpload = async (
    tenantId: string,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0] || null;
    if (!file) return;

    try {
      setUploadingLogo(true);
      const logoUrl = await uploadTenantLogo({ tenantId, file });
      setEditForm((prev) => (prev ? { ...prev, logoUrl } : prev));
      addToast("Logo enviada com sucesso.", "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Falha no upload da logo.";
      addToast(message, "error");
    } finally {
      setUploadingLogo(false);
      input.value = "";
    }
  };

  const handleSaveTenantProfile = async () => {
    if (!editingTenantId || !editForm) return;

    try {
      setSavingProfile(true);
      await updateTenantProfile({
        tenantId: editingTenantId,
        nome: editForm.nome,
        sigla: editForm.sigla,
        faculdade: editForm.faculdade,
        cidade: editForm.cidade,
        curso: editForm.curso,
        area: editForm.area,
        cnpj: editForm.cnpj,
        contatoEmail: editForm.contatoEmail,
        contatoTelefone: editForm.contatoTelefone,
        logoUrl: editForm.logoUrl,
        paletteKey: editForm.paletteKey,
        allowPublicSignup: editForm.allowPublicSignup,
        status: editForm.status,
      });

      setTenants((prev) =>
        prev.map((tenant) =>
          tenant.id === editingTenantId
            ? {
                ...tenant,
                nome: editForm.nome.trim() || tenant.nome,
                sigla: editForm.sigla.trim() || tenant.sigla,
                faculdade: editForm.faculdade.trim() || tenant.faculdade,
                cidade: editForm.cidade.trim(),
                curso: editForm.curso.trim(),
                area: editForm.area.trim(),
                cnpj: editForm.cnpj.trim(),
                contatoEmail: editForm.contatoEmail.trim(),
                contatoTelefone: editForm.contatoTelefone.trim(),
                logoUrl: editForm.logoUrl.trim(),
                paletteKey: editForm.paletteKey,
                allowPublicSignup: editForm.allowPublicSignup,
                status: editForm.status,
              }
            : tenant
        )
      );

      addToast("Cadastro da atletica atualizado.", "success");
      if (activeTenantId === editingTenantId) {
        refreshTenantTheme();
      }
      cancelEditTenant();
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao salvar cadastro da atletica.";
      addToast(message, "error");
    } finally {
      setSavingProfile(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500 w-10 h-10" />
      </div>
    );
  }

  if (!canAccess) return null;

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/95 backdrop-blur border-b border-zinc-800 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase flex items-center gap-2">
                <Shield className="text-cyan-400" size={18} /> Admin Master
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold uppercase">
                Controle global de tenants e contexto da plataforma USC
              </p>
            </div>
          </div>

          <button
            onClick={() => void loadTenants("refresh")}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-3 h-fit">
          <h2 className="text-xs font-black uppercase tracking-widest text-zinc-400">
            Atalhos da Plataforma
          </h2>
          <Link
            href="/admin/lancamento"
            className="w-full inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black px-3 py-2 text-xs font-bold uppercase text-zinc-200 hover:bg-zinc-800"
          >
            <Rocket size={14} /> Projeto de Lancamento
          </Link>
          <Link
            href="/admin/landing"
            className="w-full inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black px-3 py-2 text-xs font-bold uppercase text-zinc-200 hover:bg-zinc-800"
          >
            <Palette size={14} /> CSS da Landing USC
          </Link>
          <Link
            href="/admin/permissoes"
            className="w-full inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black px-3 py-2 text-xs font-bold uppercase text-zinc-200 hover:bg-zinc-800"
          >
            <Blocks size={14} /> Matriz de Roles
          </Link>

          <div className="pt-2 border-t border-zinc-800">
            <p className="text-[11px] font-bold uppercase text-zinc-500">
              Contexto atual
            </p>
            <p className="mt-1 text-xs text-zinc-300 break-all">
              {activeTenantId || "Global (sem override)"}
            </p>
            {isOverrideActive && (
              <button
                onClick={handleClearContext}
                className="mt-2 inline-flex items-center gap-2 rounded-lg border border-amber-600/40 bg-amber-700/10 px-3 py-1.5 text-[11px] font-black uppercase text-amber-300 hover:bg-amber-700/20"
              >
                <Slash size={13} /> Limpar contexto
              </button>
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-black uppercase text-cyan-300">
              Cadastro de Atleticas ({sortedTenants.length})
            </h2>
            <Link
              href="/nova-atletica"
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20"
            >
              Cadastrar Atletica
            </Link>
          </div>

          <div className="space-y-3">
            {sortedTenants.map((tenant) => {
              const saving = savingTenantId === tenant.id;
              const isCurrent = activeTenantId === tenant.id;
              const isEditing = editingTenantId === tenant.id && editForm !== null;

              return (
                <div
                  key={tenant.id}
                  className="rounded-xl border border-zinc-800 bg-black/40 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black uppercase text-white truncate">
                        {tenant.sigla} • {tenant.nome}
                      </p>
                      <p className="text-[11px] text-zinc-500 font-bold uppercase truncate">
                        {tenant.faculdade} • {tenant.cidade || "Sem cidade"}
                      </p>
                    </div>
                    <span
                      className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${statusBadgeClass[tenant.status]}`}
                    >
                      {tenant.status}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => handleSetTenantContext(tenant)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[11px] font-black uppercase ${
                        isCurrent
                          ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
                          : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                      }`}
                    >
                      {isCurrent ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
                      {isCurrent ? "Em contexto" : "Entrar nesse tenant"}
                    </button>

                    <button
                      onClick={() => startEditTenant(tenant)}
                      className="rounded-lg border border-cyan-500/40 bg-cyan-700/10 px-3 py-1.5 text-[11px] font-black uppercase text-cyan-300 hover:bg-cyan-700/20"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Pencil size={13} /> Editar
                      </span>
                    </button>

                    <button
                      onClick={() => void handleTenantStatus(tenant.id, "active")}
                      disabled={saving}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-600/10 px-3 py-1.5 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-600/20 disabled:opacity-60"
                    >
                      Liberar
                    </button>
                    <button
                      onClick={() => void handleTenantStatus(tenant.id, "blocked")}
                      disabled={saving}
                      className="rounded-lg border border-red-500/40 bg-red-600/10 px-3 py-1.5 text-[11px] font-black uppercase text-red-300 hover:bg-red-600/20 disabled:opacity-60"
                    >
                      Bloquear
                    </button>
                    <button
                      onClick={() => void handleTenantStatus(tenant.id, "inactive")}
                      disabled={saving}
                      className="rounded-lg border border-zinc-600 bg-zinc-700/20 px-3 py-1.5 text-[11px] font-black uppercase text-zinc-300 hover:bg-zinc-700/30 disabled:opacity-60"
                    >
                      Inativar
                    </button>
                  </div>

                  {isEditing && editForm && (
                    <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-950/80 p-4 space-y-3">
                      <h3 className="text-xs font-black uppercase text-cyan-300">
                        Editar Cadastro da Atletica
                      </h3>

                      <div className="grid md:grid-cols-2 gap-3">
                        <input
                          value={editForm.nome}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, nome: event.target.value } : prev
                            )
                          }
                          placeholder="Nome"
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                          value={editForm.sigla}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, sigla: event.target.value } : prev
                            )
                          }
                          placeholder="Sigla"
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                          value={editForm.faculdade}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, faculdade: event.target.value } : prev
                            )
                          }
                          placeholder="Faculdade"
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                          value={editForm.cidade}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, cidade: event.target.value } : prev
                            )
                          }
                          placeholder="Cidade"
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                          value={editForm.curso}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, curso: event.target.value } : prev
                            )
                          }
                          placeholder="Curso"
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        />
                        <select
                          value={editForm.area}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, area: event.target.value } : prev
                            )
                          }
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        >
                          {AREA_OPTIONS.map((option) => (
                            <option key={option.value || "default"} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={editForm.cnpj}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, cnpj: event.target.value } : prev
                            )
                          }
                          placeholder="CNPJ (opcional)"
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                          type="email"
                          value={editForm.contatoEmail}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, contatoEmail: event.target.value } : prev
                            )
                          }
                          placeholder="Email de contato"
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                          value={editForm.contatoTelefone}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, contatoTelefone: event.target.value } : prev
                            )
                          }
                          placeholder="Telefone de contato"
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        />
                        <select
                          value={editForm.paletteKey}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    paletteKey: event.target.value as TenantSummary["paletteKey"],
                                  }
                                : prev
                            )
                          }
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        >
                          <option value="green">green</option>
                          <option value="yellow">yellow</option>
                          <option value="red">red</option>
                          <option value="blue">blue</option>
                          <option value="orange">orange</option>
                          <option value="purple">purple</option>
                          <option value="pink">pink</option>
                        </select>
                      </div>

                      <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
                        <input
                          value={editForm.logoUrl}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, logoUrl: event.target.value } : prev
                            )
                          }
                          placeholder="URL da logo"
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        />
                        <label className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black uppercase cursor-pointer hover:bg-zinc-800">
                          {uploadingLogo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                          Upload logo
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => void handleLogoUpload(tenant.id, event)}
                            disabled={uploadingLogo}
                          />
                        </label>
                      </div>

                      <div className="grid md:grid-cols-3 gap-3">
                        <label className="inline-flex items-center gap-2 text-xs font-bold uppercase text-zinc-300">
                          <input
                            type="checkbox"
                            checked={editForm.allowPublicSignup}
                            onChange={(event) =>
                              setEditForm((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      allowPublicSignup: event.target.checked,
                                    }
                                  : prev
                              )
                            }
                            className="accent-emerald-500"
                          />
                          Cadastro publico
                        </label>

                        <select
                          value={editForm.status}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    status: event.target.value as TenantSummary["status"],
                                  }
                                : prev
                            )
                          }
                          className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                        >
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                          <option value="blocked">blocked</option>
                        </select>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          onClick={() => void handleSaveTenantProfile()}
                          disabled={savingProfile || uploadingLogo}
                          className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-700/20 px-3 py-2 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-700/30 disabled:opacity-60"
                        >
                          {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Salvar cadastro
                        </button>
                        <button
                          onClick={cancelEditTenant}
                          disabled={savingProfile}
                          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
                        >
                          <X size={14} /> Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {sortedTenants.length === 0 && (
              <div className="rounded-xl border border-zinc-800 bg-black/40 p-6 text-center text-zinc-500 text-sm">
                Nenhuma atletica encontrada.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
