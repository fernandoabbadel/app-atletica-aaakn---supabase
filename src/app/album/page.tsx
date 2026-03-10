"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  EyeOff,
  Pencil,
  QrCode,
  ScanLine,
  Shield,
  Trash2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { getTurmaImageCandidates } from "../../constants/turmaImages";
import {
  fetchAlbumUiConfig,
  type AlbumUiConfig,
} from "../../lib/albumUiService";
import { useAuth } from "../../context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "../../context/ToastContext";
import { resolveEffectiveAccessRole } from "../../lib/roles";
import {
  deleteTurmaConfig,
  fetchTurmasConfig,
  getDefaultTurmas,
  toggleTurmaVisibility,
  type TurmaConfig,
} from "../../lib/turmasService";

const ADMIN_ROLES = new Set([
  "master",
  "admin",
  "admin_geral",
  "admin_gestor",
  "admin_treino",
  "vendas",
]);

const resolveTurmaSlug = (turmaRaw: string | undefined, turmas: TurmaConfig[]): string => {
  const fallbackSlug =
    turmas.find((entry) => entry.id === "T8")?.slug || turmas[0]?.slug || "t8";
  if (!turmaRaw) return fallbackSlug;

  const normalizedRaw = turmaRaw.trim();
  if (!normalizedRaw) return fallbackSlug;

  const bySlug = turmas.find(
    (entry) => entry.slug.toLowerCase() === normalizedRaw.toLowerCase()
  );
  if (bySlug) return bySlug.slug;

  const upper = normalizedRaw.toUpperCase();
  const byId = turmas.find((entry) => entry.id === upper);
  if (byId) return byId.slug;

  const digits = upper.replace(/\D/g, "");
  if (digits) {
    const byDigits = turmas.find(
      (entry) => entry.slug.toLowerCase() === `t${digits}`
    );
    if (byDigits) return byDigits.slug;
  }

  return fallbackSlug;
};

export default function AlbumTurmasPage() {
  const { user } = useAuth();
  const { tenantId: activeTenantId } = useTenantTheme();
  const { addToast } = useToast();
  const [uiConfig, setUiConfig] = useState<AlbumUiConfig | null>(null);
  const [turmas, setTurmas] = useState<TurmaConfig[]>(() => getDefaultTurmas());
  const [imageFallbackIndex, setImageFallbackIndex] = useState<Record<string, number>>(
    {}
  );
  const [showMyQr, setShowMyQr] = useState(false);
  const [processingTurmaId, setProcessingTurmaId] = useState("");

  useEffect(() => {
    let mounted = true;
    const loadData = async () => {
      try {
        const [config, turmasConfig] = await Promise.all([
          fetchAlbumUiConfig({ tenantId: activeTenantId || undefined }),
          fetchTurmasConfig({ tenantId: activeTenantId || undefined }),
        ]);
        if (!mounted) return;
        setUiConfig(config);
        setTurmas(turmasConfig);
      } catch {
        if (!mounted) return;
        setUiConfig(null);
        setTurmas(getDefaultTurmas());
      }
    };
    void loadData();
    return () => {
      mounted = false;
    };
  }, [activeTenantId]);

  const title = uiConfig?.titulo?.trim() || "Album da Galera";
  const subtitle =
    uiConfig?.subtitulo?.trim() ||
    "Escolha a turma para abrir somente o que voce precisa";
  const heroHeadline = "Escolha a turma e domine o album";
  const shouldShowSubtitle =
    subtitle.trim().toLowerCase() !== heroHeadline.trim().toLowerCase();
  const hero = uiConfig?.capa?.trim() || "/capa_t8.jpg";
  const currentTurmaSlug = resolveTurmaSlug(user?.turma, turmas);
  const currentRole = resolveEffectiveAccessRole(user);
  const canEditAlbum =
    ADMIN_ROLES.has(String(user?.role || "").toLowerCase()) || ADMIN_ROLES.has(currentRole);
  const visibleTurmas = canEditAlbum ? turmas : turmas.filter((turma) => !turma.hidden);
  const turmaImageCandidates = useMemo(
    () =>
      turmas.reduce<Record<string, string[]>>((acc, turma) => {
        acc[turma.id] = getTurmaImageCandidates(turma.id, turma.logo || "/logo.png");
        return acc;
      }, {}),
    [turmas]
  );

  const handleToggleHidden = async (turma: TurmaConfig) => {
    try {
      setProcessingTurmaId(turma.id);
      const next = await toggleTurmaVisibility(turma.id, !turma.hidden, {
        tenantId: activeTenantId || undefined,
      });
      setTurmas(next);
      addToast(
        turma.hidden
          ? `Turma ${turma.id} visivel novamente na home do album.`
          : `Turma ${turma.id} escondida da home do album.`,
        "success"
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao atualizar visibilidade da turma.";
      addToast(message, "error");
    } finally {
      setProcessingTurmaId("");
    }
  };

  const handleDelete = async (turma: TurmaConfig) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Excluir a turma ${turma.id} (${turma.nome})?`);
      if (!confirmed) return;
    }

    try {
      setProcessingTurmaId(turma.id);
      const next = await deleteTurmaConfig(turma.id, {
        tenantId: activeTenantId || undefined,
      });
      setTurmas(next);
      addToast(`Turma ${turma.id} excluida com sucesso.`, "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao excluir turma.";
      addToast(message, "error");
    } finally {
      setProcessingTurmaId("");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-28">
      <header className="sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-4 md:px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/dashboard"
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 transition shrink-0"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-black uppercase tracking-tight truncate">{title}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowMyQr(true)}
              className="px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-[10px] font-black uppercase inline-flex items-center gap-2"
            >
              <QrCode size={14} />
              Meu QR
            </button>
            <Link
              href={`/album/${currentTurmaSlug}?scan=1`}
              className="px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-600 hover:bg-emerald-500 text-[10px] font-black uppercase inline-flex items-center gap-2"
            >
              <ScanLine size={14} />
              Ler QR
            </Link>
            {canEditAlbum && (
              <Link
                href="/admin/album"
                className="hidden md:inline-flex px-3 py-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[10px] font-black uppercase items-center gap-2"
              >
                <Shield size={14} />
                Editar Capa
              </Link>
            )}
          </div>
        </div>
      </header>

      <section className="relative h-64 md:h-[22rem] w-full overflow-hidden">
        <Image
          src={hero}
          alt="Capa do album"
          fill
          className="object-cover opacity-75"
          
          priority
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/30 to-black/70" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/50 to-transparent" />
        <div className="absolute bottom-6 left-4 right-4 md:left-6 md:right-6 max-w-6xl mx-auto">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400">
            Caca aos Bixos
          </p>
          <h2 className="text-3xl md:text-5xl font-black uppercase italic mt-2 leading-[0.95]">
            {heroHeadline}
          </h2>
          {shouldShowSubtitle && (
            <p className="text-xs md:text-sm text-zinc-300 mt-2 max-w-2xl">{subtitle}</p>
          )}
        </div>
      </section>

      <main className="px-4 md:px-6 mt-6 md:mt-8 relative z-20 max-w-6xl mx-auto space-y-6">
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <button
            onClick={() => setShowMyQr(true)}
            className="lg:col-span-1 px-4 py-4 rounded-2xl border border-zinc-700 bg-zinc-900/95 hover:bg-zinc-800 transition text-left shadow-xl"
          >
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white text-black">
              <QrCode size={18} />
            </div>
            <p className="mt-3 text-xs font-black uppercase text-white">Meu QR</p>
            <p className="text-[11px] text-zinc-400">Mostra seu codigo para ser capturado.</p>
          </button>

          <Link
            href={`/album/${currentTurmaSlug}?scan=1`}
            className="lg:col-span-2 px-4 py-4 rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-700/35 to-emerald-500/20 hover:from-emerald-700/50 hover:to-emerald-500/30 transition text-left shadow-xl"
          >
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500 text-black">
              <ScanLine size={18} />
            </div>
            <p className="mt-3 text-xs font-black uppercase text-white">Ler QR Agora</p>
            <p className="text-[11px] text-emerald-100">
              Abre a camera direto na sua turma para capturar na hora.
            </p>
          </Link>
        </section>

        {canEditAlbum && (
          <section className="md:hidden">
            <Link
              href="/admin/album"
              className="w-full px-4 py-3 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[11px] font-black uppercase inline-flex items-center justify-center gap-2"
            >
              <Shield size={14} />
              Editar capa do album
            </Link>
          </section>
        )}

        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {visibleTurmas.map((turma, index) => (
            <div
              key={turma.id}
              className={`group relative overflow-hidden rounded-3xl border bg-zinc-900 transition ${
                turma.hidden
                  ? "border-amber-500/30 opacity-75"
                  : "border-zinc-800 hover:border-emerald-500/40"
              }`}
            >
              {canEditAlbum && (
                <div className="absolute right-3 top-3 z-10 flex flex-wrap items-center gap-2">
                  {turma.hidden && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[9px] font-black uppercase text-amber-300">
                      Oculta
                    </span>
                  )}
                  <Link
                    href={`/admin/turma?edit=${turma.id}`}
                    className="rounded-full border border-cyan-500/30 bg-black/70 p-2 text-cyan-300 backdrop-blur"
                    title={`Editar ${turma.id}`}
                  >
                    <Pencil size={14} />
                  </Link>
                  <button
                    onClick={() => void handleToggleHidden(turma)}
                    disabled={processingTurmaId === turma.id}
                    className="rounded-full border border-amber-500/30 bg-black/70 p-2 text-amber-300 backdrop-blur disabled:opacity-60"
                    title={turma.hidden ? `Mostrar ${turma.id}` : `Esconder ${turma.id}`}
                  >
                    <EyeOff size={14} />
                  </button>
                  <button
                    onClick={() => void handleDelete(turma)}
                    disabled={processingTurmaId === turma.id}
                    className="rounded-full border border-red-500/30 bg-black/70 p-2 text-red-300 backdrop-blur disabled:opacity-60"
                    title={`Excluir ${turma.id}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}

              <Link href={`/album/${turma.slug}`} className="block">
                <div className="relative h-56 w-full">
                  <Image
                    src={
                      turmaImageCandidates[turma.id][
                        imageFallbackIndex[turma.id] ?? 0
                      ] || "/capa_t8.jpg"
                    }
                    alt={turma.nome}
                    fill
                    priority={index < 2}
                    className="object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition duration-500"
                    sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
                    onError={() =>
                      setImageFallbackIndex((prev) => {
                        const current = prev[turma.id] ?? 0;
                        const maxIndex = turmaImageCandidates[turma.id].length - 1;
                        if (current >= maxIndex) return prev;
                        return { ...prev, [turma.id]: current + 1 };
                      })
                    }
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                </div>

                <div className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] text-zinc-400 font-black uppercase tracking-wider">
                        {turma.id}
                      </p>
                      <h2 className="text-sm font-black uppercase">{turma.nome}</h2>
                      <p className="text-[11px] text-zinc-400 mt-1">{turma.mascote}</p>
                    </div>
                    <div className="w-9 h-9 rounded-full border border-zinc-700 bg-zinc-950 flex items-center justify-center text-zinc-300 group-hover:text-emerald-400 group-hover:border-emerald-500/40 transition">
                      <ChevronRight size={16} />
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </section>
      </main>

      {showMyQr && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 p-6 flex items-center justify-center"
          onClick={() => setShowMyQr(false)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-emerald-500/30 rounded-[2rem] p-6 text-center"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-black uppercase tracking-widest text-emerald-400">
              Meu Shark Code
            </p>
            <p className="text-[11px] text-zinc-400 mt-1">
              Mostre para outro integrante escanear.
            </p>
            <div className="inline-block bg-white rounded-2xl p-4 mt-5">
              <QRCodeSVG value={user?.uid || ""} size={210} />
            </div>
            <p className="mt-4 text-[10px] text-zinc-500 font-bold uppercase break-all">
              {user?.uid || "Usuario nao autenticado"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
