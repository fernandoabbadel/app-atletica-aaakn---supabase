"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";

import { useToast } from "../../../../context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  fetchAlbumConfig,
  fetchAlbumUiConfig,
  saveAlbumConfig,
  saveAlbumUiConfig,
  type AlbumCmsData,
  type AlbumUiConfig,
} from "../../../../lib/albumService";
import {
  fetchTurmasConfig,
  getDefaultTurmas,
  type TurmaConfig,
} from "../../../../lib/turmasService";

const DEFAULT_GLOBAL: AlbumUiConfig = {
  capa: "/capa_t8.jpg",
  titulo: "Album da Galera",
  subtitulo: "Escolha a turma para abrir somente o que você precisa",
};

const DEFAULT_TURMA = (turma: TurmaConfig): AlbumCmsData => ({
  capa: turma.capa || `/capa_${turma.slug || turma.id.toLowerCase()}.jpg`,
  titulo: turma.nome || `Turma ${turma.id.replace("T", "")}`,
  subtitulo: turma.mascote || "Album Oficial",
});

const buildDefaultTurmaMap = (turmas: TurmaConfig[]): Record<string, AlbumCmsData> =>
  turmas.reduce<Record<string, AlbumCmsData>>((acc, turma) => {
    acc[turma.id] = DEFAULT_TURMA(turma);
    return acc;
  }, {});

export default function AdminAlbumCustomizacaoPage() {
  const { addToast } = useToast();
  const { tenantId: activeTenantId } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingTurma, setSavingTurma] = useState(false);
  const [turmas, setTurmas] = useState<TurmaConfig[]>(() => getDefaultTurmas());
  const [selectedTurma, setSelectedTurma] = useState<string>("T8");
  const [globalConfig, setGlobalConfig] = useState<AlbumUiConfig>(DEFAULT_GLOBAL);
  const [turmaConfigMap, setTurmaConfigMap] = useState<Record<string, AlbumCmsData>>(() =>
    buildDefaultTurmaMap(getDefaultTurmas())
  );

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [globalDoc, turmasConfig] = await Promise.all([
          fetchAlbumUiConfig({ tenantId: activeTenantId || undefined }),
          fetchTurmasConfig({ tenantId: activeTenantId || undefined }),
        ]);
        if (!mounted) return;

        setGlobalConfig(globalDoc || DEFAULT_GLOBAL);
        setTurmas(turmasConfig);

        const turmaDocs = await Promise.all(
          turmasConfig.map((turma) =>
            fetchAlbumConfig(turma.id, { tenantId: activeTenantId || undefined })
          )
        );
        if (!mounted) return;

        const nextMap = turmasConfig.reduce<Record<string, AlbumCmsData>>(
          (acc, turma, index) => {
            acc[turma.id] = turmaDocs[index] || DEFAULT_TURMA(turma);
            return acc;
          },
          {}
        );
        setTurmaConfigMap(nextMap);

        const fallbackSelected =
          turmasConfig.find((turma) => turma.id === "T8")?.id ||
          turmasConfig[0]?.id ||
          "T8";
        setSelectedTurma((prev) =>
          turmasConfig.some((turma) => turma.id === prev) ? prev : fallbackSelected
        );
      } catch {
        if (mounted) addToast("Erro ao carregar customização do álbum.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, addToast]);

  const selectedTurmaData = useMemo(() => {
    const selected = turmas.find((turma) => turma.id === selectedTurma);
    return selected || turmas[0] || getDefaultTurmas()[0];
  }, [selectedTurma, turmas]);

  const turmaConfig = useMemo(
    () =>
      turmaConfigMap[selectedTurmaData.id] || DEFAULT_TURMA(selectedTurmaData),
    [selectedTurmaData, turmaConfigMap]
  );

  const handleSaveGlobal = async () => {
    try {
      setSavingGlobal(true);
      await saveAlbumUiConfig(globalConfig, {
        tenantId: activeTenantId || undefined,
      });
      addToast("Customização da página /album salva.", "success");
    } catch {
      addToast("Erro ao salvar customização da home do álbum.", "error");
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleSaveTurma = async () => {
    try {
      setSavingTurma(true);
      await saveAlbumConfig(selectedTurmaData.id, turmaConfig, {
        tenantId: activeTenantId || undefined,
      });
      addToast(`Customização da turma ${selectedTurmaData.id} salva.`, "success");
    } catch {
      addToast("Erro ao salvar customização da turma.", "error");
    } finally {
      setSavingTurma(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center text-sm font-black uppercase">
        Carregando customização...
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
            <h1 className="text-xl font-black uppercase tracking-tight">Customização Álbum</h1>
            <p className="text-[11px] text-zinc-500 font-bold">
              Capa, título e subtítulo da página /album e /album/[turma]
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-4xl mx-auto space-y-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-black uppercase text-emerald-400">Página /album (global)</h2>
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
            {savingGlobal ? "Salvando..." : "Salvar página /album"}
          </button>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-black uppercase text-cyan-400">Página /album/[turma]</h2>
          <div className="flex flex-wrap gap-2">
            {turmas.map((turma) => (
              <button
                key={turma.id}
                onClick={() => setSelectedTurma(turma.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase border ${
                  selectedTurmaData.id === turma.id
                    ? "bg-cyan-500/20 border-cyan-400 text-cyan-300"
                    : "bg-black border-zinc-700 text-zinc-400"
                }`}
              >
                {turma.id}
              </button>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">
                Titulo ({selectedTurmaData.id})
              </label>
              <input
                value={turmaConfig.titulo}
                onChange={(event) =>
                  setTurmaConfigMap((prev) => ({
                    ...prev,
                    [selectedTurmaData.id]: {
                      ...(prev[selectedTurmaData.id] || DEFAULT_TURMA(selectedTurmaData)),
                      titulo: event.target.value,
                    },
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
                    [selectedTurmaData.id]: {
                      ...(prev[selectedTurmaData.id] || DEFAULT_TURMA(selectedTurmaData)),
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
                  [selectedTurmaData.id]: {
                    ...(prev[selectedTurmaData.id] || DEFAULT_TURMA(selectedTurmaData)),
                    capa: event.target.value,
                  },
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
            {savingTurma ? "Salvando..." : `Salvar ${selectedTurmaData.id}`}
          </button>
        </section>
      </main>
    </div>
  );
}
