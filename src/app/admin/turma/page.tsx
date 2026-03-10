"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  addTurmaConfig,
  deleteTurmaConfig,
  fetchTurmasConfig,
  toggleTurmaVisibility,
  updateTurmaConfig,
  type TurmaConfig,
} from "@/lib/turmasService";

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message || "Erro inesperado.";
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
    const message = [raw.message, raw.details, raw.hint]
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .filter((entry) => entry.length > 0)
      .join(" | ");
    if (message) return message;
  }
  return "Erro inesperado.";
};

const normalizeTurmaIdInput = (raw: string): string => {
  const normalized = raw.trim().toUpperCase();
  if (!normalized) return "";
  if (/^T\d{1,3}$/.test(normalized)) {
    return `T${String(Number(normalized.slice(1)))}`;
  }

  const digits = normalized.replace(/\D/g, "");
  if (!digits) return "";
  return `T${String(Number(digits))}`;
};

const getSuggestedTurmaId = (turmas: TurmaConfig[]): string => {
  const maxNumber = turmas.reduce((acc, turma) => {
    const parsed = Number(turma.id.replace(/\D/g, ""));
    if (!Number.isFinite(parsed)) return acc;
    return Math.max(acc, parsed);
  }, 8);

  return `T${maxNumber + 1}`;
};

type TurmaFormState = {
  id: string;
  nome: string;
  mascote: string;
  capa: string;
  logo: string;
};

const EMPTY_FORM: TurmaFormState = {
  id: "T9",
  nome: "",
  mascote: "",
  capa: "",
  logo: "",
};

const buildFormFromTurma = (turma: TurmaConfig): TurmaFormState => ({
  id: turma.id,
  nome: turma.nome,
  mascote: turma.mascote,
  capa: turma.capa,
  logo: turma.logo,
});

export default function AdminTurmaPage() {
  const { addToast } = useToast();
  const { tenantId: activeTenantId } = useTenantTheme();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rowActionId, setRowActionId] = useState("");
  const [turmas, setTurmas] = useState<TurmaConfig[]>([]);
  const [form, setForm] = useState<TurmaFormState>(EMPTY_FORM);
  const [editingTurmaId, setEditingTurmaId] = useState("");

  const requestedEditId = normalizeTurmaIdInput(searchParams.get("edit") || "");

  const sortedTurmas = useMemo(
    () =>
      [...turmas].sort((left, right) => {
        const leftN = Number(left.id.replace(/\D/g, ""));
        const rightN = Number(right.id.replace(/\D/g, ""));
        const weightLeft = Number.isFinite(leftN) ? leftN : Number.MAX_SAFE_INTEGER;
        const weightRight = Number.isFinite(rightN) ? rightN : Number.MAX_SAFE_INTEGER;
        if (weightLeft !== weightRight) return weightLeft - weightRight;
        return left.id.localeCompare(right.id, "pt-BR");
      }),
    [turmas]
  );

  const resetToCreateMode = useCallback((rows: TurmaConfig[]) => {
    setEditingTurmaId("");
    setForm({
      ...EMPTY_FORM,
      id: getSuggestedTurmaId(rows),
    });
  }, []);

  const syncEditMode = useCallback(
    (rows: TurmaConfig[]) => {
      if (!requestedEditId) {
        if (editingTurmaId) {
          resetToCreateMode(rows);
        } else if (!form.id) {
          setForm({
            ...EMPTY_FORM,
            id: getSuggestedTurmaId(rows),
          });
        }
        return;
      }

      const target = rows.find((turma) => turma.id === requestedEditId);
      if (!target) {
        resetToCreateMode(rows);
        return;
      }

      if (editingTurmaId !== target.id) {
        setEditingTurmaId(target.id);
        setForm(buildFormFromTurma(target));
      }
    },
    [editingTurmaId, form.id, requestedEditId, resetToCreateMode]
  );

  const refreshTurmas = async (): Promise<void> => {
    const rows = await fetchTurmasConfig({
      forceRefresh: true,
      tenantId: activeTenantId || undefined,
    });
    setTurmas(rows);
    syncEditMode(rows);
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const rows = await fetchTurmasConfig({
          tenantId: activeTenantId || undefined,
        });
        if (!mounted) return;
        setTurmas(rows);
        syncEditMode(rows);
      } catch (error: unknown) {
        if (!mounted) return;
        addToast(`Erro ao carregar turmas: ${extractErrorMessage(error)}`, "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, addToast, syncEditMode]);

  useEffect(() => {
    if (loading) return;
    syncEditMode(turmas);
  }, [loading, syncEditMode, turmas]);

  const handleStartEdit = (turmaId: string) => {
    router.replace(`/admin/turma?edit=${turmaId}`);
  };

  const handleCancelEdit = () => {
    router.replace("/admin/turma");
  };

  const handleSubmit = async () => {
    const normalizedId = normalizeTurmaIdInput(form.id);
    if (!normalizedId) {
      addToast("Informe uma turma valida (ex: T9).", "error");
      return;
    }

    try {
      setSaving(true);

      const next = editingTurmaId
        ? await updateTurmaConfig({
            id: editingTurmaId,
            nome: form.nome.trim() || undefined,
            mascote: form.mascote.trim() || undefined,
            capa: form.capa.trim() || undefined,
            logo: form.logo.trim() || undefined,
          }, { tenantId: activeTenantId || undefined })
        : await addTurmaConfig({
            id: normalizedId,
            nome: form.nome.trim() || undefined,
            mascote: form.mascote.trim() || undefined,
            capa: form.capa.trim() || undefined,
            logo: form.logo.trim() || undefined,
          }, { tenantId: activeTenantId || undefined });

      setTurmas(next);

      if (editingTurmaId) {
        const updated = next.find((turma) => turma.id === editingTurmaId);
        if (updated) {
          setForm(buildFormFromTurma(updated));
        }
        addToast(`Turma ${editingTurmaId} atualizada com sucesso.`, "success");
      } else {
        addToast(`Turma ${normalizedId} criada com sucesso.`, "success");
        resetToCreateMode(next);
      }
    } catch (error: unknown) {
      addToast(`Erro ao salvar turma: ${extractErrorMessage(error)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleHidden = async (turma: TurmaConfig) => {
    try {
      setRowActionId(turma.id);
      const next = await toggleTurmaVisibility(turma.id, !turma.hidden, {
        tenantId: activeTenantId || undefined,
      });
      setTurmas(next);
      addToast(
        turma.hidden
          ? `Turma ${turma.id} voltou para a home do album.`
          : `Turma ${turma.id} escondida da home do album.`,
        "success"
      );
    } catch (error: unknown) {
      addToast(`Erro ao alterar visibilidade: ${extractErrorMessage(error)}`, "error");
    } finally {
      setRowActionId("");
    }
  };

  const handleDelete = async (turma: TurmaConfig) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Excluir a turma ${turma.id} (${turma.nome})?`);
      if (!confirmed) return;
    }

    try {
      setRowActionId(turma.id);
      const next = await deleteTurmaConfig(turma.id, {
        tenantId: activeTenantId || undefined,
      });
      setTurmas(next);
      if (editingTurmaId === turma.id) {
        handleCancelEdit();
        resetToCreateMode(next);
      }
      addToast(`Turma ${turma.id} excluida com sucesso.`, "success");
    } catch (error: unknown) {
      addToast(`Erro ao excluir turma: ${extractErrorMessage(error)}`, "error");
    } finally {
      setRowActionId("");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center text-sm font-black uppercase">
        Carregando turmas...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-20 font-sans">
      <header className="sticky top-0 z-20 bg-[#050505]/95 backdrop-blur border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">
                Turma Admin
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold uppercase">
                Turmas do Album
              </p>
            </div>
          </div>

          <button
            onClick={() => void refreshTurmas()}
            className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs font-black uppercase inline-flex items-center gap-2"
          >
            <RefreshCw size={14} />
            Atualizar
          </button>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase text-emerald-400">
                {editingTurmaId ? `Editar ${editingTurmaId}` : "Adicionar Turma"}
              </h2>
              <p className="text-[11px] text-zinc-500 font-bold">
                A turma aparece automaticamente em /album e em /admin/album/customizacao.
              </p>
            </div>

            {editingTurmaId && (
              <button
                onClick={handleCancelEdit}
                className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-950 hover:bg-zinc-800 text-xs font-black uppercase inline-flex items-center gap-2"
              >
                <X size={14} />
                Nova Turma
              </button>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Codigo</label>
              <input
                value={form.id}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, id: event.target.value }))
                }
                placeholder="T9"
                disabled={Boolean(editingTurmaId)}
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm disabled:opacity-60"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Nome</label>
              <input
                value={form.nome}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, nome: event.target.value }))
                }
                placeholder="Turma IX"
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Mascote</label>
              <input
                value={form.mascote}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, mascote: event.target.value }))
                }
                placeholder="Golfinho"
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Logo (opcional)</label>
              <input
                value={form.logo}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, logo: event.target.value }))
                }
                placeholder="/turma9.jpg"
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Capa (opcional)</label>
              <input
                value={form.capa}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, capa: event.target.value }))
                }
                placeholder="/capa_t9.jpg"
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-xs font-black uppercase inline-flex items-center gap-2"
          >
            {editingTurmaId ? <Save size={14} /> : <Plus size={14} />}
            {saving
              ? "Salvando..."
              : editingTurmaId
              ? "Salvar Alteracoes"
              : "Adicionar Turma"}
          </button>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-cyan-400" />
            <h2 className="text-sm font-black uppercase text-cyan-400">Turmas Atuais</h2>
          </div>

          <div className="space-y-2">
            {sortedTurmas.map((turma) => {
              const isBusy = rowActionId === turma.id;
              return (
                <div
                  key={turma.id}
                  className={`rounded-xl border px-4 py-3 ${
                    turma.hidden
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-zinc-800 bg-black/50"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-black uppercase text-white">
                          {turma.id} - {turma.nome}
                        </p>
                        {turma.hidden && (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase text-amber-300">
                            Oculta
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400">{turma.mascote}</p>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">
                        /album/{turma.slug}
                      </span>
                      <button
                        onClick={() => handleStartEdit(turma.id)}
                        className="px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-[10px] font-black uppercase text-cyan-300 inline-flex items-center gap-1"
                      >
                        <Pencil size={12} />
                        Editar
                      </button>
                      <button
                        onClick={() => void handleToggleHidden(turma)}
                        disabled={isBusy}
                        className="px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[10px] font-black uppercase text-amber-300 inline-flex items-center gap-1 disabled:opacity-60"
                      >
                        <EyeOff size={12} />
                        {turma.hidden ? "Mostrar" : "Esconder"}
                      </button>
                      <button
                        onClick={() => void handleDelete(turma)}
                        disabled={isBusy}
                        className="px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-[10px] font-black uppercase text-red-300 inline-flex items-center gap-1 disabled:opacity-60"
                      >
                        <Trash2 size={12} />
                        Excluir
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
