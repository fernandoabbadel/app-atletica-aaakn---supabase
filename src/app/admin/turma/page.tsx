"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  EyeOff,
  Expand,
  ImagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
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
import { uploadImage } from "@/lib/upload";

const MAX_TURMA_ID_LENGTH = 4;
const MAX_TURMA_NAME_LENGTH = 60;
const MAX_TURMA_MASCOT_LENGTH = 40;

type TurmaFormState = {
  id: string;
  nome: string;
  mascote: string;
  capa: string;
  logo: string;
};

type PreviewState = {
  src: string;
  label: string;
};

const EMPTY_FORM: TurmaFormState = {
  id: "T9",
  nome: "",
  mascote: "",
  capa: "",
  logo: "",
};

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

const buildFormFromTurma = (turma: TurmaConfig): TurmaFormState => ({
  id: turma.id,
  nome: turma.nome,
  mascote: turma.mascote,
  capa: turma.capa,
  logo: turma.logo,
});

const buildImageSrc = (value: string, fallback: string): string => {
  const cleanValue = value.trim();
  return cleanValue || fallback;
};

export default function AdminTurmaPage() {
  const { addToast } = useToast();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rowActionId, setRowActionId] = useState("");
  const [turmas, setTurmas] = useState<TurmaConfig[]>([]);
  const [form, setForm] = useState<TurmaFormState>(EMPTY_FORM);
  const [editingTurmaId, setEditingTurmaId] = useState("");
  const [uploadingField, setUploadingField] = useState<"" | "logo" | "capa">("");
  const [previewImage, setPreviewImage] = useState<PreviewState | null>(null);

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
          forceRefresh: true,
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
    router.replace("/admin/turma?edit=" + turmaId);
  };

  const handleCancelEdit = () => {
    router.replace("/admin/turma");
  };

  const handleImageUpload = async (
    field: "logo" | "capa",
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const normalizedId = normalizeTurmaIdInput(form.id) || editingTurmaId || "draft";
    if (!file || uploadingField) {
      input.value = "";
      return;
    }

    const isLogo = field === "logo";
    try {
      setUploadingField(field);
      const { url, error } = await uploadImage(
        file,
        `turmas/${activeTenantId || "global"}/${isLogo ? "logos" : "capas"}`,
        {
          scopeKey: `admin:turmas:${field}`,
          maxBytes: isLogo ? 2 * 1024 * 1024 : 3 * 1024 * 1024,
          maxWidth: isLogo ? 1400 : 1800,
          maxHeight: isLogo ? 1400 : 1800,
          maxPixels: isLogo ? 1_960_000 : 3_240_000,
          compressionMaxWidth: isLogo ? 1200 : 1600,
          compressionMaxHeight: isLogo ? 1200 : 1600,
          compressionMaxBytes: isLogo ? 140 * 1024 : 220 * 1024,
          fileName: `${normalizedId}-${field}`,
          upsert: true,
          appendVersionQuery: true,
        }
      );

      if (error || !url) {
        addToast(
          `${isLogo ? "Logo" : "Capa"} invalida: ${error || "Falha no upload."}`,
          "error"
        );
        return;
      }

      setForm((previous) => ({ ...previous, [field]: url }));
      addToast(
        `${isLogo ? "Logo" : "Capa"} enviada com sucesso. O arquivo foi reduzido para economizar storage e egress.`,
        "success"
      );
    } catch (error: unknown) {
      addToast(
        `Erro ao enviar ${isLogo ? "logo" : "capa"}: ${extractErrorMessage(error)}`,
        "error"
      );
    } finally {
      setUploadingField("");
      input.value = "";
    }
  };

  const handleSubmit = async () => {
    const normalizedId = normalizeTurmaIdInput(form.id);
    if (!normalizedId) {
      addToast("Informe uma turma valida, como T9 ou T10.", "error");
      return;
    }

    try {
      setSaving(true);

      const next = editingTurmaId
        ? await updateTurmaConfig(
            {
              id: editingTurmaId,
              nome: form.nome.trim() || undefined,
              mascote: form.mascote.trim() || undefined,
              capa: form.capa.trim() || undefined,
              logo: form.logo.trim() || undefined,
            },
            { tenantId: activeTenantId || undefined }
          )
        : await addTurmaConfig(
            {
              id: normalizedId,
              nome: form.nome.trim() || undefined,
              mascote: form.mascote.trim() || undefined,
              capa: form.capa.trim() || undefined,
              logo: form.logo.trim() || undefined,
            },
            { tenantId: activeTenantId || undefined }
          );

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
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-sm font-black uppercase text-white">
        Carregando turmas...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] pb-20 font-sans text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/95 px-6 py-5 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
              title="Voltar ao painel admin"
              aria-label="Voltar ao painel admin"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Turma Admin</h1>
              <p className="text-[11px] font-bold uppercase text-zinc-500">Turmas do album</p>
            </div>
          </div>

          <button
            onClick={() => void refreshTurmas()}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black uppercase hover:bg-zinc-800"
            title="Atualizar lista de turmas"
          >
            <RefreshCw size={14} />
            Atualizar
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase text-emerald-400">
                {editingTurmaId ? `Editar ${editingTurmaId}` : "Adicionar turma"}
              </h2>
              <p className="text-[11px] font-bold text-zinc-500">
                A turma aparece automaticamente em /album, em /admin/album/customizacao e usa o
                mesmo cadastro de logo/capa.
              </p>
            </div>

            {editingTurmaId ? (
              <button
                onClick={handleCancelEdit}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-black uppercase hover:bg-zinc-800"
                title="Criar nova turma"
              >
                <X size={14} />
                Nova turma
              </button>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-[11px] font-bold uppercase text-zinc-400">Codigo</label>
              <input
                value={form.id}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, id: event.target.value }))
                }
                placeholder="T9"
                maxLength={MAX_TURMA_ID_LENGTH}
                disabled={Boolean(editingTurmaId)}
                className="mt-1 w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm disabled:opacity-60"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase text-zinc-400">Nome</label>
              <input
                value={form.nome}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, nome: event.target.value }))
                }
                placeholder="Turma IX"
                maxLength={MAX_TURMA_NAME_LENGTH}
                className="mt-1 w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase text-zinc-400">Mascote</label>
              <input
                value={form.mascote}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, mascote: event.target.value }))
                }
                placeholder="Golfinho"
                maxLength={MAX_TURMA_MASCOT_LENGTH}
                className="mt-1 w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm"
              />
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black/35 p-4">
              <p className="text-[11px] font-black uppercase text-zinc-400">Limites autom&aacute;ticos</p>
              <p className="mt-2 text-[11px] text-zinc-500">
                Logo at&eacute; 2MB e capa at&eacute; 3MB. Aceita PNG, JPG e WEBP. O app reduz os
                arquivos antes do envio para economizar storage e egress no Supabase.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {(
              [
                {
                  key: "logo" as const,
                  label: "Logo da turma",
                  helper: "Mostrada no card da turma e no album.",
                  fallback: "/logo.png",
                },
                {
                  key: "capa" as const,
                  label: "Capa da turma",
                  helper: "Usada como destaque na pagina do album da turma.",
                  fallback: "/capa_t8.jpg",
                },
              ] as const
            ).map((entry) => {
              const imageSrc = buildImageSrc(form[entry.key], entry.fallback);
              const isUploading = uploadingField === entry.key;
              return (
                <div key={entry.key} className="rounded-2xl border border-zinc-800 bg-black/35 p-4">
                  <p className="text-[11px] font-black uppercase text-zinc-300">{entry.label}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">{entry.helper}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewImage({
                          src: imageSrc,
                          label: `${entry.label} - ${form.nome || normalizeTurmaIdInput(form.id) || "turma"}`,
                        })
                      }
                      className="relative h-24 w-24 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 transition hover:border-emerald-500/50"
                      title={`Ampliar ${entry.label.toLowerCase()}`}
                    >
                      <Image
                        src={imageSrc}
                        alt={entry.label}
                        fill
                        sizes="96px"
                        className="object-cover"
                        unoptimized={imageSrc.startsWith("http")}
                      />
                    </button>

                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-[11px] font-black uppercase text-emerald-200 transition hover:bg-emerald-500/20">
                      <ImagePlus size={14} />
                      {isUploading ? "Enviando..." : "Adicionar foto"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={Boolean(uploadingField)}
                        onChange={(event) => void handleImageUpload(entry.key, event)}
                      />
                    </label>
                    <ImageResizeHelpLink label={`Diminuir ${entry.key === "logo" ? "a logo" : "a capa"} no favicon.io/favicon-converter`} />

                    <button
                      type="button"
                      onClick={() =>
                        setPreviewImage({
                          src: imageSrc,
                          label: `${entry.label} - ${form.nome || normalizeTurmaIdInput(form.id) || "turma"}`,
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-[11px] font-black uppercase text-zinc-200 transition hover:bg-zinc-800"
                      title={`Ver ${entry.label.toLowerCase()} maior`}
                    >
                      <Expand size={14} />
                      Ampliar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase disabled:opacity-60 hover:bg-emerald-500"
          >
            {editingTurmaId ? <Save size={14} /> : <Plus size={14} />}
            {saving
              ? "Salvando..."
              : editingTurmaId
                ? "Salvar alteracoes"
                : "Adicionar turma"}
          </button>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users size={16} className="text-cyan-400" />
            <h2 className="text-sm font-black uppercase text-cyan-400">Turmas atuais</h2>
          </div>

          <div className="space-y-2">
            {sortedTurmas.map((turma) => {
              const isBusy = rowActionId === turma.id;
              const logoSrc = buildImageSrc(turma.logo, "/logo.png");
              const albumHref = tenantSlug ? `/${tenantSlug}/album/${turma.slug}` : `/album/${turma.slug}`;
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
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewImage({
                            src: logoSrc,
                            label: `${turma.id} - ${turma.nome}`,
                          })
                        }
                        className="relative h-14 w-14 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 transition hover:border-cyan-500/50"
                        title={`Ampliar logo da ${turma.nome}`}
                      >
                        <Image
                          src={logoSrc}
                          alt={`Logo ${turma.nome}`}
                          fill
                          sizes="56px"
                          className="object-cover"
                          unoptimized={logoSrc.startsWith("http")}
                        />
                      </button>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-black uppercase text-white">
                            {turma.id} - {turma.nome}
                          </p>
                          {turma.hidden ? (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase text-amber-300">
                              Oculta
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[11px] text-zinc-400">{turma.mascote}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Link
                        href={albumHref}
                        className="text-[10px] font-bold uppercase text-zinc-500 hover:text-white"
                        title={`Abrir album da ${turma.nome}`}
                      >
                        /album/{turma.slug}
                      </Link>
                      <button
                        onClick={() => handleStartEdit(turma.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-black uppercase text-cyan-300"
                        title={`Editar ${turma.nome}`}
                      >
                        <Pencil size={12} />
                        Editar
                      </button>
                      <button
                        onClick={() => void handleToggleHidden(turma)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-black uppercase text-amber-300 disabled:opacity-60"
                        title={turma.hidden ? "Mostrar turma no album" : "Esconder turma do album"}
                      >
                        <EyeOff size={12} />
                        {turma.hidden ? "Mostrar" : "Esconder"}
                      </button>
                      <button
                        onClick={() => void handleDelete(turma)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[10px] font-black uppercase text-red-300 disabled:opacity-60"
                        title={`Excluir ${turma.nome}`}
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

      {previewImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="w-full max-w-2xl rounded-3xl border border-zinc-700 bg-[#090909] p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-black uppercase text-white">{previewImage.label}</p>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="rounded-full border border-zinc-700 bg-zinc-900 p-2 text-zinc-200 hover:bg-zinc-800"
                title="Fechar imagem ampliada"
              >
                <X size={16} />
              </button>
            </div>
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black">
              <Image
                src={previewImage.src}
                alt={previewImage.label}
                fill
                sizes="90vw"
                className="object-contain"
                unoptimized={previewImage.src.startsWith("http")}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
