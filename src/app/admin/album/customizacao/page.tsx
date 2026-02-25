"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";

import { useToast } from "../../../../context/ToastContext";
import {
  fetchAlbumConfig,
  fetchAlbumUiConfig,
  saveAlbumConfig,
  saveAlbumUiConfig,
  type AlbumCmsData,
  type AlbumUiConfig,
} from "../../../../lib/albumService";

type TurmaKey = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8";

const TURMAS: TurmaKey[] = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"];

const DEFAULT_GLOBAL: AlbumUiConfig = {
  capa: "/capa_t8.jpg",
  titulo: "Album da Galera",
  subtitulo: "Escolha a turma para abrir somente o que voce precisa",
};

const DEFAULT_TURMA = (turma: TurmaKey): AlbumCmsData => ({
  capa: `/capa_${turma.toLowerCase()}.jpg`,
  titulo: `Turma ${turma.replace("T", "")}`,
  subtitulo: "Album Oficial",
});

export default function AdminAlbumCustomizacaoPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingTurma, setSavingTurma] = useState(false);
  const [selectedTurma, setSelectedTurma] = useState<TurmaKey>("T8");
  const [globalConfig, setGlobalConfig] = useState<AlbumUiConfig>(DEFAULT_GLOBAL);
  const [turmaConfigMap, setTurmaConfigMap] = useState<Record<TurmaKey, AlbumCmsData>>(
    () =>
      TURMAS.reduce(
        (acc, turma) => ({ ...acc, [turma]: DEFAULT_TURMA(turma) }),
        {} as Record<TurmaKey, AlbumCmsData>
      )
  );

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [globalDoc, ...turmaDocs] = await Promise.all([
          fetchAlbumUiConfig(),
          ...TURMAS.map((turma) => fetchAlbumConfig(turma)),
        ]);
        if (!mounted) return;

        setGlobalConfig(globalDoc || DEFAULT_GLOBAL);

        const nextMap = TURMAS.reduce((acc, turma, index) => {
          acc[turma] = turmaDocs[index] || DEFAULT_TURMA(turma);
          return acc;
        }, {} as Record<TurmaKey, AlbumCmsData>);
        setTurmaConfigMap(nextMap);
      } catch {
        if (mounted) addToast("Erro ao carregar customizacao do album.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  const turmaConfig = useMemo(
    () => turmaConfigMap[selectedTurma] || DEFAULT_TURMA(selectedTurma),
    [selectedTurma, turmaConfigMap]
  );

  const handleSaveGlobal = async () => {
    try {
      setSavingGlobal(true);
      await saveAlbumUiConfig(globalConfig);
      addToast("Customizacao da pagina /album salva.", "success");
    } catch {
      addToast("Erro ao salvar customizacao da home do album.", "error");
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleSaveTurma = async () => {
    try {
      setSavingTurma(true);
      await saveAlbumConfig(selectedTurma, turmaConfig);
      addToast(`Customizacao da turma ${selectedTurma} salva.`, "success");
    } catch {
      addToast("Erro ao salvar customizacao da turma.", "error");
    } finally {
      setSavingTurma(false);
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
            href="/admin/album"
            className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          >
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Customizacao Album</h1>
            <p className="text-[11px] text-zinc-500 font-bold">
              Capa, titulo e subtitulo da pagina /album e /album/[turma]
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-4xl mx-auto space-y-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-black uppercase text-emerald-400">Pagina /album (global)</h2>
          <div className="grid md:grid-cols-2 gap-4">
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
            <label className="text-[11px] text-zinc-400 font-bold uppercase">Capa (/public ou URL)</label>
            <input
              value={globalConfig.capa}
              onChange={(event) =>
                setGlobalConfig((prev) => ({ ...prev, capa: event.target.value }))
              }
              className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleSaveGlobal}
            disabled={savingGlobal}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-xs font-black uppercase inline-flex items-center gap-2"
          >
            <Save size={14} />
            {savingGlobal ? "Salvando..." : "Salvar pagina /album"}
          </button>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-black uppercase text-cyan-400">Pagina /album/[turma]</h2>
          <div className="flex flex-wrap gap-2">
            {TURMAS.map((turma) => (
              <button
                key={turma}
                onClick={() => setSelectedTurma(turma)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase border ${
                  selectedTurma === turma
                    ? "bg-cyan-500/20 border-cyan-400 text-cyan-300"
                    : "bg-black border-zinc-700 text-zinc-400"
                }`}
              >
                {turma}
              </button>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">
                Titulo ({selectedTurma})
              </label>
              <input
                value={turmaConfig.titulo}
                onChange={(event) =>
                  setTurmaConfigMap((prev) => ({
                    ...prev,
                    [selectedTurma]: { ...prev[selectedTurma], titulo: event.target.value },
                  }))
                }
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Subtitulo</label>
              <input
                value={turmaConfig.subtitulo}
                onChange={(event) =>
                  setTurmaConfigMap((prev) => ({
                    ...prev,
                    [selectedTurma]: {
                      ...prev[selectedTurma],
                      subtitulo: event.target.value,
                    },
                  }))
                }
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-zinc-400 font-bold uppercase">Capa (/public ou URL)</label>
            <input
              value={turmaConfig.capa}
              onChange={(event) =>
                setTurmaConfigMap((prev) => ({
                  ...prev,
                  [selectedTurma]: { ...prev[selectedTurma], capa: event.target.value },
                }))
              }
              className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleSaveTurma}
            disabled={savingTurma}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-xs font-black uppercase inline-flex items-center gap-2"
          >
            <Save size={14} />
            {savingTurma ? "Salvando..." : `Salvar ${selectedTurma}`}
          </button>
        </section>
      </main>
    </div>
  );
}

