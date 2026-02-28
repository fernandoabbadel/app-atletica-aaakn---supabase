"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCcw, Save, Trash2 } from "lucide-react";

import {
  deletePlan,
  fetchPlanCatalog,
  restoreDefaultPlanCatalog,
  upsertPlan,
  type PlanRecord,
} from "../../../../lib/plansService";
import {
  PLAN_COLOR_OPTIONS,
  PLAN_ICON_OPTIONS,
  resolvePlanIcon,
  resolvePlanTheme,
} from "../../../../constants/planVisuals";
import { useToast } from "../../../../context/ToastContext";

type PlanFormState = {
  nome: string;
  preco: string;
  precoVal: string;
  parcelamento: string;
  descricao: string;
  cor: string;
  icon: string;
  destaque: boolean;
  beneficiosText: string;
  xpMultiplier: string;
  nivelPrioridade: string;
  descontoLoja: string;
};

const EMPTY_FORM: PlanFormState = {
  nome: "",
  preco: "0,00",
  precoVal: "0",
  parcelamento: "",
  descricao: "",
  cor: "zinc",
  icon: "ghost",
  destaque: false,
  beneficiosText: "",
  xpMultiplier: "1",
  nivelPrioridade: "1",
  descontoLoja: "0",
};

const toFormState = (row: PlanRecord): PlanFormState => ({
  nome: row.nome,
  preco: row.preco,
  precoVal: String(row.precoVal ?? 0),
  parcelamento: row.parcelamento,
  descricao: row.descricao,
  cor: row.cor || "zinc",
  icon: row.icon || "ghost",
  destaque: Boolean(row.destaque),
  beneficiosText: (row.beneficios || []).join("\n"),
  xpMultiplier: String(row.xpMultiplier ?? 1),
  nivelPrioridade: String(row.nivelPrioridade ?? 1),
  descontoLoja: String(row.descontoLoja ?? 0),
});

const parseNumber = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value.replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default function AdminPlanosEditarPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanFormState>(EMPTY_FORM);

  const load = async (forceRefresh = true) => {
    const plans = await fetchPlanCatalog({ maxResults: 40, forceRefresh });
    setRows(plans);
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await load(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedPlanId(null);
      setForm(EMPTY_FORM);
      return;
    }

    const selected = rows.find((entry) => entry.id === selectedPlanId) ?? rows[0];
    setSelectedPlanId(selected.id);
    setForm(toFormState(selected));
  }, [rows, selectedPlanId]);

  const selectPlan = (row: PlanRecord) => {
    setSelectedPlanId(row.id);
    setForm(toFormState(row));
  };

  const handleSave = async () => {
    if (!selectedPlanId) return;
    if (!form.nome.trim()) {
      addToast("Informe o nome do plano.", "error");
      return;
    }

    setSaving(true);
    try {
      await upsertPlan({
        id: selectedPlanId,
        data: {
          nome: form.nome.trim(),
          preco: form.preco.trim() || "0,00",
          precoVal: Math.max(0, parseNumber(form.precoVal, 0)),
          parcelamento: form.parcelamento.trim(),
          descricao: form.descricao.trim(),
          cor: form.cor.trim() || "zinc",
          icon: form.icon.trim() || "ghost",
          destaque: form.destaque,
          beneficios: form.beneficiosText
            .split("\n")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
          xpMultiplier: Math.max(0, parseNumber(form.xpMultiplier, 1)),
          nivelPrioridade: Math.max(1, Math.round(parseNumber(form.nivelPrioridade, 1))),
          descontoLoja: Math.max(0, Math.round(parseNumber(form.descontoLoja, 0))),
        },
      });
      addToast("Plano atualizado.", "success");
      await load(true);
    } catch (error: unknown) {
      console.error("Falha ao salvar plano:", error);
      addToast("Erro ao salvar plano.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remover plano?")) return;
    try {
      await deletePlan(id);
      addToast("Plano removido.", "success");
      await load(true);
    } catch {
      addToast("Erro ao remover plano.", "error");
    }
  };

  const handleRestoreDefaults = async () => {
    if (!confirm("Restaurar planos padrao? Isso ira recriar o catalogo base.")) return;
    setRestoring(true);
    try {
      const result = await restoreDefaultPlanCatalog();
      if (result.skipped) {
        addToast("Ja existem planos cadastrados. Nenhuma restauracao foi feita.", "info");
      } else {
        addToast("Planos padrao restaurados.", "success");
      }
      await load(true);
    } catch {
      addToast("Erro ao restaurar planos padrao.", "error");
    } finally {
      setRestoring(false);
    }
  };

  const previewTheme = resolvePlanTheme(form.cor);
  const PreviewIcon = resolvePlanIcon(form.icon);

  const fieldClass =
    "w-full rounded-lg border border-zinc-700 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500";
  const labelClass = "text-[10px] font-black uppercase text-zinc-500 tracking-wide";

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link href="/admin/planos" className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Editar</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Catalogo de planos</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-end">
          <button
            onClick={() => void handleRestoreDefaults()}
            disabled={restoring}
            className="px-3 py-2 rounded-lg border border-blue-500/40 bg-blue-500/10 text-blue-400 text-[11px] font-black uppercase inline-flex items-center gap-1 disabled:opacity-60"
          >
            <RefreshCcw size={12} className={restoring ? "animate-spin" : ""} />
            {restoring ? "Restaurando..." : "Restaurar Planos Padrao"}
          </button>
        </div>

        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">Sem planos cadastrados.</div>
        ) : (
          <div className="grid lg:grid-cols-[320px_1fr] gap-4">
            <section className="space-y-3">
              {rows.map((row) => {
                const theme = resolvePlanTheme(row.cor);
                const RowIcon = resolvePlanIcon(row.icon);
                const selected = row.id === selectedPlanId;

                return (
                  <article
                    key={row.id}
                    className={`rounded-xl border p-3 transition ${
                      selected
                        ? "bg-zinc-900 border-emerald-500/40"
                        : "bg-zinc-900/70 border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <button
                      onClick={() => selectPlan(row)}
                      className="w-full text-left flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <p className="text-sm font-bold truncate">{row.nome}</p>
                        <p className="text-[11px] text-zinc-400 uppercase">Prioridade: {row.nivelPrioridade}</p>
                        <p className="text-sm font-black text-emerald-400">R$ {Number(row.precoVal || 0).toFixed(2)}</p>
                        <div
                          className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full border ${theme.badgeClass}`}
                        >
                          <RowIcon size={11} />
                          <span className="uppercase">{row.cor}</span>
                        </div>
                      </div>
                    </button>
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => void handleDelete(row.id)}
                        className="p-2 rounded-lg border border-red-500/30 bg-red-900/20 text-red-400 hover:bg-red-900/40"
                        title="Excluir plano"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>

            <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-zinc-300">Editar Plano</p>
                  <p className="text-[11px] text-zinc-500 font-bold">ID: {selectedPlanId || "--"}</p>
                </div>
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${previewTheme.badgeClass}`}>
                  <PreviewIcon size={12} />
                  <span className="uppercase">{form.nome || "Plano"}</span>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className={labelClass}>Nome</label>
                  <input
                    className={fieldClass}
                    value={form.nome}
                    onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Preco (texto)</label>
                  <input
                    className={fieldClass}
                    value={form.preco}
                    onChange={(e) => setForm((prev) => ({ ...prev, preco: e.target.value }))}
                    placeholder="29,90"
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Preco numerico</label>
                  <input
                    className={fieldClass}
                    value={form.precoVal}
                    onChange={(e) => setForm((prev) => ({ ...prev, precoVal: e.target.value }))}
                    inputMode="decimal"
                    placeholder="29.9"
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Parcelamento</label>
                  <input
                    className={fieldClass}
                    value={form.parcelamento}
                    onChange={(e) => setForm((prev) => ({ ...prev, parcelamento: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Cor</label>
                  <input
                    list="plan-color-options"
                    className={fieldClass}
                    value={form.cor}
                    onChange={(e) => setForm((prev) => ({ ...prev, cor: e.target.value }))}
                  />
                  <datalist id="plan-color-options">
                    {PLAN_COLOR_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Icone</label>
                  <input
                    list="plan-icon-options"
                    className={fieldClass}
                    value={form.icon}
                    onChange={(e) => setForm((prev) => ({ ...prev, icon: e.target.value }))}
                  />
                  <datalist id="plan-icon-options">
                    {PLAN_ICON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>XP Multiplier</label>
                  <input
                    className={fieldClass}
                    value={form.xpMultiplier}
                    onChange={(e) => setForm((prev) => ({ ...prev, xpMultiplier: e.target.value }))}
                    inputMode="decimal"
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Desconto Loja (%)</label>
                  <input
                    className={fieldClass}
                    value={form.descontoLoja}
                    onChange={(e) => setForm((prev) => ({ ...prev, descontoLoja: e.target.value }))}
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Prioridade</label>
                  <input
                    className={fieldClass}
                    value={form.nivelPrioridade}
                    onChange={(e) => setForm((prev) => ({ ...prev, nivelPrioridade: e.target.value }))}
                    inputMode="numeric"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs font-bold uppercase text-zinc-300 mt-6">
                  <input
                    type="checkbox"
                    checked={form.destaque}
                    onChange={(e) => setForm((prev) => ({ ...prev, destaque: e.target.checked }))}
                    className="accent-emerald-500"
                  />
                  Plano Destaque
                </label>
              </div>

              <div className="space-y-1">
                <label className={labelClass}>Descricao</label>
                <textarea
                  className={`${fieldClass} min-h-[80px]`}
                  value={form.descricao}
                  onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <label className={labelClass}>Beneficios (1 por linha)</label>
                <textarea
                  className={`${fieldClass} min-h-[140px]`}
                  value={form.beneficiosText}
                  onChange={(e) => setForm((prev) => ({ ...prev, beneficiosText: e.target.value }))}
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || !selectedPlanId}
                  className="px-4 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 text-xs font-black uppercase inline-flex items-center gap-2 disabled:opacity-60"
                >
                  <Save size={14} />
                  {saving ? "Salvando..." : "Salvar Alteracoes"}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
