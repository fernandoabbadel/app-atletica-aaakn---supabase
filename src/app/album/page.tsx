"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ChevronRight, QrCode, ScanLine, Shield } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { getTurmaImageCandidates } from "../../constants/turmaImages";
import {
  fetchAlbumUiConfig,
  type AlbumUiConfig,
} from "../../lib/albumUiService";
import { useAuth } from "../../context/AuthContext";

const TURMAS = [
  { id: "T1", slug: "t1", nome: "Turma I", mascote: "Jacare", frase: "Primeira linhagem" },
  { id: "T2", slug: "t2", nome: "Turma II", mascote: "Cavalo Marinho", frase: "Cardume estrategico" },
  { id: "T3", slug: "t3", nome: "Turma III", mascote: "Tartaruga", frase: "Resistencia e foco" },
  { id: "T4", slug: "t4", nome: "Turma IV", mascote: "Baleia", frase: "Forca de oceano" },
  { id: "T5", slug: "t5", nome: "Turma V", mascote: "Pinguim", frase: "Velocidade no gelo" },
  { id: "T6", slug: "t6", nome: "Turma VI", mascote: "Lagosta", frase: "Blindagem natural" },
  { id: "T7", slug: "t7", nome: "Turma VII", mascote: "Urso Polar", frase: "Predadores de elite" },
  { id: "T8", slug: "t8", nome: "Turma VIII", mascote: "Calouros", frase: "Caca aos bixos" },
] as const;

const ADMIN_ROLES = new Set([
  "master",
  "admin",
  "admin_geral",
  "admin_gestor",
  "admin_treino",
  "vendas",
]);

const resolveTurmaSlug = (turmaRaw?: string): string => {
  if (!turmaRaw) return "t8";
  const normalized = turmaRaw.trim().toUpperCase();
  if (normalized.startsWith("T")) return normalized.toLowerCase();
  const digits = normalized.replace(/\D/g, "");
  return digits ? `t${digits}` : "t8";
};

export default function AlbumTurmasPage() {
  const { user } = useAuth();
  const [uiConfig, setUiConfig] = useState<AlbumUiConfig | null>(null);
  const [imageFallbackIndex, setImageFallbackIndex] = useState<Record<string, number>>(
    {}
  );
  const [showMyQr, setShowMyQr] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadUi = async () => {
      try {
        const config = await fetchAlbumUiConfig();
        if (!mounted) return;
        setUiConfig(config);
      } catch {
        if (mounted) setUiConfig(null);
      }
    };
    void loadUi();
    return () => {
      mounted = false;
    };
  }, []);

  const title = uiConfig?.titulo?.trim() || "Album da Galera";
  const subtitle =
    uiConfig?.subtitulo?.trim() ||
    "Escolha a turma para abrir somente o que voce precisa";
  const heroHeadline = "Escolha a turma e domine o album";
  const shouldShowSubtitle =
    subtitle.trim().toLowerCase() !== heroHeadline.trim().toLowerCase();
  const hero = uiConfig?.capa?.trim() || "/capa_t8.jpg";
  const currentTurmaSlug = resolveTurmaSlug(user?.turma);
  const canEditAlbum = ADMIN_ROLES.has(String(user?.role || "").toLowerCase());
  const turmaImageCandidates = useMemo(
    () =>
      TURMAS.reduce<Record<string, string[]>>((acc, turma) => {
        acc[turma.id] = getTurmaImageCandidates(turma.id);
        return acc;
      }, {}),
    []
  );

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
          unoptimized
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
          {TURMAS.map((turma, index) => (
            <Link
              key={turma.id}
              href={`/album/${turma.slug}`}
              className="group relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 hover:border-emerald-500/40 transition"
            >
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
                  unoptimized
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
                    <p className="text-[10px] text-zinc-500 mt-1">{turma.frase}</p>
                  </div>
                  <div className="w-9 h-9 rounded-full border border-zinc-700 bg-zinc-950 flex items-center justify-center text-zinc-300 group-hover:text-emerald-400 group-hover:border-emerald-500/40 transition">
                    <ChevronRight size={16} />
                  </div>
                </div>
              </div>
            </Link>
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
