"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, HeartHandshake, Loader2, Save } from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchMentorshipLabels,
  saveMentorshipLabels,
  type MentorshipLabelsConfig,
} from "@/lib/mentorshipService";
import { withTenantSlug } from "@/lib/tenantRouting";

const EMPTY_FORM: MentorshipLabelsConfig = {
  hubTitle: "Apadrinhamento",
  mentorLabel: "Padrinho/Madrinha",
  menteeLabel: "Afilhado/Afilhada",
  inviteMentorLabel: "Adicionar como meu padrinho/madrinha",
  inviteMenteeLabel: "Adicionar como meu afilhado/afilhada",
  requestHelpText: "Cada perfil pode ter 1 padrinho/madrinha e 1 afilhado/afilhada por atlética.",
};

export default function AdminApadrinhamentoPage() {
  const { tenantId, tenantName, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<MentorshipLabelsConfig>(EMPTY_FORM);

  const adminHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin") : "/admin";

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!tenantId.trim()) {
        if (mounted) setLoading(false);
        return;
      }
      try {
        const next = await fetchMentorshipLabels({ tenantId, forceRefresh: true });
        if (mounted) setForm(next);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar configuração do apadrinhamento.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [addToast, tenantId]);

  const handleSave = async () => {
    if (!tenantId.trim() || saving) return;
    try {
      setSaving(true);
      const next = await saveMentorshipLabels(form, { tenantId });
      setForm(next);
      addToast("Configuração de apadrinhamento salva.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast(error instanceof Error ? error.message : "Erro ao salvar configuração.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] pb-24 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href={adminHref} className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800">
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Admin Apadrinhamento</h1>
              <p className="text-[11px] font-bold text-zinc-500">
                Títulos dinâmicos para {tenantName || "a atlética ativa"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading || !tenantId.trim()}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <section className="overflow-hidden rounded-[2rem] border border-cyan-500/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_35%),linear-gradient(135deg,rgba(8,47,73,0.45),rgba(10,10,10,0.95)_45%,rgba(8,47,73,0.2))] p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
              <HeartHandshake size={22} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300">Rotulos Dinamicos</p>
              <h2 className="mt-1 text-xl font-black uppercase tracking-tight text-white">Personalize a linguagem do vinculo</h2>
              <p className="mt-2 max-w-3xl text-sm text-cyan-50/75">
                O que for salvo aqui aparece no perfil público, na central do usuário e na área de aceite dos convites.
              </p>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="flex items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-900/60 p-10">
            <Loader2 className="animate-spin text-cyan-400" />
          </div>
        ) : (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Título da área"
                  value={form.hubTitle}
                  onChange={(value) => setForm((previous) => ({ ...previous, hubTitle: value }))}
                />
                <Field
                  label="Rotulo do mentor"
                  value={form.mentorLabel}
                  onChange={(value) => setForm((previous) => ({ ...previous, mentorLabel: value }))}
                />
                <Field
                  label="Rotulo do afilhado"
                  value={form.menteeLabel}
                  onChange={(value) => setForm((previous) => ({ ...previous, menteeLabel: value }))}
                />
                <Field
                  label="Botao para pedir mentor"
                  value={form.inviteMentorLabel}
                  onChange={(value) => setForm((previous) => ({ ...previous, inviteMentorLabel: value }))}
                />
                <div className="md:col-span-2">
                  <Field
                    label="Botao para pedir afilhado"
                    value={form.inviteMenteeLabel}
                    onChange={(value) => setForm((previous) => ({ ...previous, inviteMenteeLabel: value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                    Texto de apoio
                  </label>
                  <textarea
                    value={form.requestHelpText}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        requestHelpText: event.target.value.slice(0, 220),
                      }))
                    }
                    rows={4}
                    className="mt-2 w-full rounded-2xl border border-zinc-700 bg-black/40 px-4 py-3 text-sm outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Preview</p>
              <div className="mt-4 rounded-3xl border border-zinc-800 bg-black/30 p-5">
                <h3 className="text-lg font-black uppercase text-white">{form.hubTitle}</h3>
                <p className="mt-2 text-sm text-zinc-400">{form.requestHelpText}</p>

                <div className="mt-5 grid gap-3">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">{form.mentorLabel}</p>
                    <p className="mt-1 text-sm text-zinc-400">{form.inviteMentorLabel}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">{form.menteeLabel}</p>
                    <p className="mt-1 text-sm text-zinc-400">{form.inviteMenteeLabel}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, 120))}
        className="mt-2 w-full rounded-2xl border border-zinc-700 bg-black/40 px-4 py-3 text-sm outline-none focus:border-cyan-500"
      />
    </div>
  );
}
