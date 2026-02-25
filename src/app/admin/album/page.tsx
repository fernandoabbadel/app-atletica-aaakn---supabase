"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Medal, Palette, Save, ShieldCheck, Trophy } from "lucide-react";

import { useToast } from "../../../context/ToastContext";
import {
  fetchAlbumUiConfig,
  saveAlbumUiConfig,
  type AlbumUiConfig,
} from "../../../lib/albumService";

const menuItems = [
  {
    href: "/admin/album/caca_calouro",
    title: "Caca Calouro",
    description: "Predadores de bixos T8",
    icon: ShieldCheck,
    color: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  },
  {
    href: "/admin/album/pontua_calouro",
    title: "Pontua Calouro",
    description: "Ranking interno dos calouros",
    icon: Medal,
    color: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  },
  {
    href: "/admin/album/pontua_geral",
    title: "Pontua Geral",
    description: "Top geral de capturas",
    icon: Trophy,
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  },
  {
    href: "/admin/album/customizacao",
    title: "Customizacao",
    description: "Editar por turma e layout avancado",
    icon: Palette,
    color: "text-fuchsia-400 border-fuchsia-500/30 bg-fuchsia-500/10",
  },
] as const;

const DEFAULT_GLOBAL: AlbumUiConfig = {
  capa: "/capa_t8.jpg",
  titulo: "Album da Galera",
  subtitulo: "Escolha a turma para abrir somente o que voce precisa",
};

export default function AdminAlbumMenuPage() {
  const { addToast } = useToast();
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [globalConfig, setGlobalConfig] = useState<AlbumUiConfig>(DEFAULT_GLOBAL);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const config = await fetchAlbumUiConfig();
        if (!mounted) return;
        setGlobalConfig(config || DEFAULT_GLOBAL);
      } catch {
        if (mounted) addToast("Erro ao carregar capa do album.", "error");
      } finally {
        if (mounted) setLoadingConfig(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  const handleSaveGlobal = async () => {
    try {
      setSavingConfig(true);
      await saveAlbumUiConfig(globalConfig);
      addToast("Capa e textos da /album atualizados.", "success");
    } catch {
      addToast("Erro ao salvar configuracao da capa.", "error");
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          >
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Admin Album</h1>
            <p className="text-[11px] text-zinc-500 font-bold">
              Integrado com a capa da pagina /album
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto">
        <section className="mb-6 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase text-emerald-400">
                Capa da Pagina /album
              </h2>
              <p className="text-[11px] text-zinc-500 font-bold">
                Edita em tempo real titulo, subtitulo e imagem da home do album.
              </p>
            </div>
            <button
              onClick={handleSaveGlobal}
              disabled={savingConfig || loadingConfig}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-xs font-black uppercase inline-flex items-center gap-2"
            >
              <Save size={14} />
              {savingConfig ? "Salvando..." : "Salvar Capa"}
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Titulo</label>
              <input
                value={globalConfig.titulo}
                onChange={(event) =>
                  setGlobalConfig((prev) => ({ ...prev, titulo: event.target.value }))
                }
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Subtitulo</label>
              <input
                value={globalConfig.subtitulo}
                onChange={(event) =>
                  setGlobalConfig((prev) => ({ ...prev, subtitulo: event.target.value }))
                }
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] text-zinc-400 font-bold uppercase">
              Imagem da Capa (/public ou URL)
            </label>
            <input
              value={globalConfig.capa}
              onChange={(event) =>
                setGlobalConfig((prev) => ({ ...prev, capa: event.target.value }))
              }
              className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
          </div>

          <p className="text-[11px] text-zinc-500">
            Para capa/titulo/subtitulo por turma, use o modulo `Customizacao`.
          </p>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-600 transition"
              >
                <div
                  className={`w-11 h-11 rounded-xl border flex items-center justify-center ${item.color}`}
                >
                  <Icon size={18} />
                </div>
                <h2 className="mt-4 text-sm font-black uppercase">{item.title}</h2>
                <p className="mt-2 text-xs text-zinc-400">{item.description}</p>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}

