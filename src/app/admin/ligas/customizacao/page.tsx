"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";

import { useToast } from "../../../../context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  DEFAULT_LIGAS_USC_UI_CONFIG,
  fetchLigasUscUiConfig,
  saveLigasUscUiConfig,
  type LigasUscUiConfig,
} from "../../../../lib/ligasUscUiService";

export default function AdminLigasCustomizacaoPage() {
  const { addToast } = useToast();
  const { tenantId: activeTenantId } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<LigasUscUiConfig>(DEFAULT_LIGAS_USC_UI_CONFIG);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const nextConfig = await fetchLigasUscUiConfig({
          tenantId: activeTenantId || undefined,
        });
        if (!mounted) return;
        setConfig(nextConfig);
      } catch {
        if (mounted) addToast("Erro ao carregar configuracao da pagina de ligas.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, addToast]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await saveLigasUscUiConfig(config, {
        tenantId: activeTenantId || undefined,
      });
      addToast("Titulo e subtitulo da pagina /ligas_usc atualizados.", "success");
    } catch {
      addToast("Erro ao salvar configuracao da pagina de ligas.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center text-sm font-black uppercase">
        Carregando customizacao...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/ligas"
            className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          >
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Customizacao Ligas USC</h1>
            <p className="text-[11px] text-zinc-500 font-bold">
              Ajuste o titulo e o subtitulo da pagina publica /ligas_usc
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-4xl mx-auto space-y-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-black uppercase text-emerald-400">
              Cabecalho da pagina
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              O tenant admin pode trocar esses dois textos quando quiser.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Titulo</label>
              <input
                value={config.titulo}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, titulo: event.target.value }))
                }
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
                placeholder="LIGAS USC"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Subtitulo</label>
              <input
                value={config.subtitulo}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, subtitulo: event.target.value }))
                }
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
                placeholder="Ecossistema Academico"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] text-zinc-400 font-bold uppercase">
              Texto pequeno do card
            </label>
            <input
              value={config.rotuloCard}
              onChange={(event) =>
                setConfig((prev) => ({ ...prev, rotuloCard: event.target.value }))
              }
              maxLength={28}
              className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              placeholder="Liga USC"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Esse texto aparece acima do nome em cada card da pagina /ligas_usc.
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-xs font-black uppercase inline-flex items-center gap-2"
          >
            <Save size={14} />
            {saving ? "Salvando..." : "Salvar pagina /ligas_usc"}
          </button>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-black uppercase text-cyan-400">Preview</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Assim o topo e o card publico vao aparecer depois de salvar.
            </p>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(18,18,18,0.96),rgba(5,5,5,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
            <div className="max-w-2xl">
              <h3 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                {config.titulo || DEFAULT_LIGAS_USC_UI_CONFIG.titulo}
              </h3>
              <p className="mt-2 text-sm font-semibold text-zinc-400 sm:text-base">
                {config.subtitulo || DEFAULT_LIGAS_USC_UI_CONFIG.subtitulo}
              </p>
            </div>
          </div>

          <div className="max-w-sm rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(14,14,14,0.94),rgba(5,5,5,1))] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">
              {config.rotuloCard || DEFAULT_LIGAS_USC_UI_CONFIG.rotuloCard}
            </p>
            <h3 className="mt-2 line-clamp-2 text-lg font-black uppercase leading-tight text-white">
              Liga Academica de Exemplo
            </h3>
            <p className="mt-2 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-200">
              LAEX
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
