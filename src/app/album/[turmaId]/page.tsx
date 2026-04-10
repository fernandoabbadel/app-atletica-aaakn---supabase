"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Heart,
  Instagram,
  Lock,
  MapPin,
  PawPrint,
  QrCode,
  ScanLine,
  Sparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Html5Qrcode } from "html5-qrcode";
import { QRCodeSVG } from "qrcode.react";

import { useAuth } from "../../../context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "../../../context/ToastContext";
import {
  fetchAlbumCollectedIds,
  fetchAlbumConfig,
  fetchAlbumUiConfig,
  fetchUsersByTurmaPage,
  registerAlbumCapture,
  type AlbumCmsData,
  type AlbumUiConfig,
  type AlbumUsersPageResult,
} from "../../../lib/albumService";
import { getTurmaImage } from "../../../constants/turmaImages";
import {
  fetchTurmasConfig,
  getDefaultTurmas,
  type TurmaConfig,
} from "../../../lib/turmasService";
import {
  fetchCadastroConfig,
  getDefaultCadastroConfig,
  type CadastroConfig,
} from "@/lib/cadastroConfigService";
import { calculateAgeFromBirthDate } from "@/lib/birthDate";
import {
  getBackendErrorCode,
  isPermissionError,
} from "@/lib/backendErrors";
import { getSportPresentation } from "@/lib/cadastroOptions";
import { withTenantSlug } from "@/lib/tenantRouting";

interface UserData {
  id: string;
  nome: string;
  turma: string;
  foto?: string;
  apelido?: string;
  dataNascimento?: string;
  idadePublica?: boolean;
  esportes?: string[];
  pets?: string;
  cidadeOrigem?: string;
  relacionamentoPublico?: boolean;
  statusRelacionamento?: string;
  bio?: string;
  instagram?: string;
}

const USERS_PAGE_SIZE = 20;
const DEFAULT_AVATAR = "https://github.com/shadcn.png";

const parseTurmaSlug = (slug: string | undefined, turmas: TurmaConfig[]): string => {
  const fallbackId = turmas.find((entry) => entry.id === "T8")?.id || turmas[0]?.id || "T8";
  if (!slug) return fallbackId;

  const normalizedSlug = slug.trim().toLowerCase().replace(/\//g, "");
  if (!normalizedSlug) return fallbackId;

  const bySlug = turmas.find((entry) => entry.slug.toLowerCase() === normalizedSlug);
  if (bySlug) return bySlug.id;

  const upper = normalizedSlug.toUpperCase();
  const byId = turmas.find((entry) => entry.id === upper);
  if (byId) return byId.id;

  const digits = upper.replace(/\D/g, "");
  if (digits) {
    const byDigits = turmas.find(
      (entry) => entry.id === `T${digits}` || entry.slug.toLowerCase() === `t${digits}`
    );
    if (byDigits) return byDigits.id;
  }

  return fallbackId;
};

const extractTargetUidFromQr = (rawValue: string): string => {
  const raw = rawValue.trim();
  if (!raw) return "";

  if (/^[A-Za-z0-9_-]{24,60}$/.test(raw)) return raw;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const fromJson =
      (typeof parsed.uid === "string" && parsed.uid) ||
      (typeof parsed.userId === "string" && parsed.userId) ||
      (typeof parsed.targetUid === "string" && parsed.targetUid) ||
      (typeof parsed.id === "string" && parsed.id) ||
      "";
    if (fromJson && /^[A-Za-z0-9_-]{24,60}$/.test(fromJson.trim())) return fromJson.trim();
  } catch {
    // pode nao ser JSON
  }

  try {
    const url = new URL(raw);
    const candidates = [
      url.searchParams.get("uid"),
      url.searchParams.get("userId"),
      url.searchParams.get("targetUid"),
      url.searchParams.get("id"),
    ].filter((value): value is string => Boolean(value && value.trim()));
    for (const value of candidates) {
      const clean = value.trim();
      if (/^[A-Za-z0-9_-]{24,60}$/.test(clean)) return clean;
    }
    const lastPath = url.pathname.split("/").filter(Boolean).pop();
    if (lastPath && /^[A-Za-z0-9_-]{24,60}$/.test(lastPath)) return lastPath;
  } catch {
    // pode nao ser URL
  }

  const token = raw
    .split(/[/?#=&\s]+/)
    .map((item) => item.trim())
    .find((item) => /^[A-Za-z0-9_-]{24,60}$/.test(item));

  return token || "";
};

export default function AlbumTurmaPage() {
  const params = useParams<{ turmaId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [turmas, setTurmas] = useState<TurmaConfig[]>(() => getDefaultTurmas());
  const turma = useMemo(
    () => parseTurmaSlug(params?.turmaId, turmas),
    [params?.turmaId, turmas]
  );

  const { user, loading: authLoading } = useAuth();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const effectiveTenantId = activeTenantId || user?.tenant_id || "";

  const userUid = user?.uid;
  const [usuarios, setUsuarios] = useState<UserData[]>([]);
  const [usersCursorId, setUsersCursorId] = useState<string | null>(null);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const [loadingMoreUsers, setLoadingMoreUsers] = useState(false);
  const [meuAlbum, setMeuAlbum] = useState<string[]>([]);
  const [turmaConfig, setTurmaConfig] = useState<AlbumCmsData | null>(null);
  const [albumUiConfig, setAlbumUiConfig] = useState<AlbumUiConfig | null>(null);
  const [cadastroConfig, setCadastroConfig] = useState<CadastroConfig>(getDefaultCadastroConfig);
  const [coverSrc, setCoverSrc] = useState<string>("");
  const [showMyQr, setShowMyQr] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [loadingAlbum, setLoadingAlbum] = useState(true);
  const [loadingTurma, setLoadingTurma] = useState(true);
  const [processingScan, setProcessingScan] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingScanRef = useRef(false);
  const lastScanAtRef = useRef(0);
  const autoScanHandledRef = useRef(false);
  const meuAlbumRef = useRef<string[]>([]);

  useEffect(() => {
    meuAlbumRef.current = meuAlbum;
  }, [meuAlbum]);

  const calcularIdade = (dataNasc?: string): string => {
    const idade = calculateAgeFromBirthDate(dataNasc);
    return idade === null ? "??" : String(idade);
  };

  const resolveSportInfo = useCallback(
    (sport: string) => getSportPresentation(sport, cadastroConfig.sportOptions),
    [cadastroConfig.sportOptions]
  );

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      await scanner.clear();
    } catch {
      // ignora cleanup
    } finally {
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!userUid) {
      setMeuAlbum([]);
      setLoadingAlbum(false);
      return;
    }

    let mounted = true;
    setLoadingAlbum(true);

    const loadAlbum = async () => {
      try {
        const collectedIds = await fetchAlbumCollectedIds(userUid, {
          turma,
          maxResults: 240,
          tenantId: effectiveTenantId || undefined,
        });
        if (!mounted) return;
        setMeuAlbum(collectedIds);
      } catch (error: unknown) {
        if (!mounted) return;
        const hadAlbumData = meuAlbumRef.current.length > 0;
        if (!isPermissionError(error) && !hadAlbumData) {
          addToast("Erro ao carregar seu album.", "error");
        }
        // Mantem estado atual em caso de falha pontual de leitura para nao "apagar" capturas ja exibidas.
        setMeuAlbum((prev) => prev);
      } finally {
        if (mounted) setLoadingAlbum(false);
      }
    };

    void loadAlbum();
    return () => {
      mounted = false;
    };
  }, [authLoading, userUid, turma, addToast, effectiveTenantId]);

  useEffect(() => {
    if (authLoading) return;
    if (!userUid) {
      setUsuarios([]);
      setUsersCursorId(null);
      setHasMoreUsers(false);
      setTurmaConfig(null);
      setAlbumUiConfig(null);
      setLoadingTurma(false);
      return;
    }

    let mounted = true;
    setLoadingTurma(true);

    const loadTurma = async () => {
      try {
        const [usersResult, cmsResult, uiResult, turmasResult, cadastroResult] = await Promise.allSettled([
          fetchUsersByTurmaPage(turma, {
            pageSize: USERS_PAGE_SIZE,
            tenantId: effectiveTenantId || undefined,
          }),
          fetchAlbumConfig(turma, { tenantId: effectiveTenantId || undefined }),
          fetchAlbumUiConfig({ tenantId: effectiveTenantId || undefined }),
          fetchTurmasConfig({ tenantId: effectiveTenantId || undefined }),
          fetchCadastroConfig({ tenantId: effectiveTenantId || undefined }),
        ]);
        if (!mounted) return;

        if (usersResult.status === "fulfilled") {
          setUsuarios(usersResult.value.users as UserData[]);
          setUsersCursorId(usersResult.value.nextCursorId);
          setHasMoreUsers(usersResult.value.hasMore);
        } else {
          if (!isPermissionError(usersResult.reason)) {
            addToast("Erro ao carregar turma.", "error");
          }
          setUsuarios([]);
          setUsersCursorId(null);
          setHasMoreUsers(false);
        }

        if (cmsResult.status === "fulfilled") {
          setTurmaConfig(cmsResult.value);
        } else {
          setTurmaConfig(null);
        }

        if (uiResult.status === "fulfilled") {
          setAlbumUiConfig(uiResult.value);
        } else {
          setAlbumUiConfig(null);
        }

        if (turmasResult.status === "fulfilled") {
          setTurmas(turmasResult.value);
        }

        if (cadastroResult.status === "fulfilled") {
          setCadastroConfig(cadastroResult.value);
        } else {
          setCadastroConfig(getDefaultCadastroConfig());
        }
      } finally {
        if (mounted) setLoadingTurma(false);
      }
    };

    void loadTurma();
    return () => {
      mounted = false;
    };
  }, [authLoading, userUid, turma, addToast, effectiveTenantId]);

  const loadMoreUsers = useCallback(async () => {
    if (!hasMoreUsers || !usersCursorId || loadingMoreUsers) return;
    setLoadingMoreUsers(true);
    try {
      const page: AlbumUsersPageResult = await fetchUsersByTurmaPage(turma, {
        pageSize: USERS_PAGE_SIZE,
        cursorId: usersCursorId,
        tenantId: effectiveTenantId || undefined,
      });
      setUsuarios((prev) => {
        const known = new Set(prev.map((row) => row.id));
        const appended = page.users.filter((row) => !known.has(row.id));
        return [...prev, ...(appended as UserData[])];
      });
      setUsersCursorId(page.nextCursorId);
      setHasMoreUsers(page.hasMore);
    } catch {
      addToast("Erro ao carregar mais integrantes.", "error");
    } finally {
      setLoadingMoreUsers(false);
    }
  }, [hasMoreUsers, usersCursorId, loadingMoreUsers, turma, addToast, effectiveTenantId]);

  useEffect(() => {
    if (autoScanHandledRef.current) return;
    if (searchParams.get("scan") !== "1") return;
    autoScanHandledRef.current = true;
    setShowScanner(true);
  }, [searchParams]);

  const handleFoundUser = useCallback(
    async (rawScanned: string) => {
      if (!user || processingScanRef.current) return;

      const now = Date.now();
      if (now - lastScanAtRef.current < 1800) return;
      lastScanAtRef.current = now;

      const targetId = extractTargetUidFromQr(rawScanned);
      if (!targetId) {
        addToast("QR invalido. Tente um QR de usuario.", "error");
        return;
      }

      processingScanRef.current = true;
      setProcessingScan(true);
      try {
        setShowScanner(false);
        await stopScanner();

        if (targetId === user.uid) {
          addToast("Voce nao pode se escanear.", "info");
          return;
        }
        if (meuAlbum.includes(targetId)) {
          addToast("Figurinha repetida.", "info");
          return;
        }

        const result = await registerAlbumCapture({
          collector: {
            uid: user.uid,
            nome: user.nome || "Atleta",
            turma: user.turma,
            foto: user.foto,
          },
          targetId,
          tenantId: effectiveTenantId || undefined,
        });

        if (result.status === "invalid-target") {
          addToast("Codigo invalido ou usuario nao encontrado.", "error");
          return;
        }
        if (result.status === "duplicate") {
          addToast("Figurinha repetida.", "info");
          return;
        }

        setMeuAlbum((prev) => (prev.includes(targetId) ? prev : [...prev, targetId]));
        addToast(`Captura confirmada: ${result.targetName || "Integrante"}.`, "success");
      } catch (error: unknown) {
        const errorCode = getBackendErrorCode(error)?.toLowerCase() || "";
        const message = error instanceof Error ? error.message.toLowerCase() : "";

        if (
          errorCode === "23505" ||
          message.includes("duplicate key") ||
          message.includes("unique")
        ) {
          addToast("Figurinha repetida.", "info");
        } else if (isPermissionError(error)) {
          addToast("Sem permissao para registrar captura. Revise as politicas do Supabase.", "error");
        } else {
          addToast("Erro ao registrar captura.", "error");
        }
      } finally {
        processingScanRef.current = false;
        setProcessingScan(false);
      }
    },
    [user, meuAlbum, addToast, stopScanner, effectiveTenantId]
  );

  useEffect(() => {
    if (!showScanner || scannerRef.current) return;

    const startScanner = async () => {
      try {
        if (
          typeof window !== "undefined" &&
          window.location.protocol !== "https:" &&
          window.location.hostname !== "localhost" &&
          window.location.hostname !== "127.0.0.1"
        ) {
          throw new Error("insecure-context");
        }

        const scannerRoot = document.getElementById("reader");
        if (!scannerRoot) return;

        const html5QrCode = new Html5Qrcode("reader");
        scannerRef.current = html5QrCode;

        const scannerConfig = {
          fps: 8,
          qrbox: { width: 230, height: 230 },
          aspectRatio: 1,
          disableFlip: false,
        };

        const onSuccess = (decodedText: string) => {
          void handleFoundUser(decodedText);
        };

        const cameras = await Html5Qrcode.getCameras();
        const preferredCamera =
          cameras.find((camera) => /back|traseira|rear|environment/i.test(camera.label)) ||
          cameras[0];

        const sources: Array<string | { facingMode: string }> = [];
        if (preferredCamera?.id) sources.push(preferredCamera.id);
        sources.push({ facingMode: "environment" });
        sources.push({ facingMode: "user" });

        let started = false;
        for (const source of sources) {
          try {
            await html5QrCode.start(source, scannerConfig, onSuccess, () => {});
            started = true;
            break;
          } catch {
            // tenta proxima camera
          }
        }

        if (!started) throw new Error("camera-not-found");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("insecure-context")) {
          addToast("Para abrir a camera use HTTPS (ou localhost).", "error");
        } else if (message.includes("camera-not-found")) {
          addToast("Nenhuma camera encontrada no dispositivo.", "error");
        } else {
          addToast("Erro ao abrir camera.", "error");
        }
        await stopScanner();
        setShowScanner(false);
      }
    };

    void startScanner();
    return () => {
      void stopScanner();
    };
  }, [showScanner, handleFoundUser, addToast, stopScanner]);

  const statsTurma = useMemo(() => {
    const totalCadastrados = usuarios.length;
    const totalEuPeguei = usuarios.filter((u) => meuAlbum.includes(u.id)).length;
    return { pegos: totalEuPeguei, total: totalCadastrados };
  }, [usuarios, meuAlbum]);

  const turmaMeta = useMemo(() => {
    const selected = turmas.find((entry) => entry.id === turma);
    if (selected) return selected;

    const digits = turma.replace(/\D/g, "");
    const slug = digits ? `t${digits}` : turma.toLowerCase();
    return {
      id: turma || "T8",
      slug: slug || "t8",
      nome: `Turma ${digits || turma.replace(/[^A-Z0-9]/g, "")}`.trim(),
      mascote: "Mascote",
      capa: slug ? `/capa_${slug}.jpg` : "/capa_t8.jpg",
      logo: getTurmaImage(turma || "T8"),
      hidden: false,
    } as TurmaConfig;
  }, [turma, turmas]);

  const turmaCover = turmaConfig?.capa?.trim() || turmaMeta.capa || "/capa_t8.jpg";
  const turmaTitle = turmaConfig?.titulo?.trim() || turmaMeta.nome;
  const turmaSubtitle = turmaConfig?.subtitulo?.trim() || turmaMeta.mascote || "Album Oficial";
  const pageTitle = albumUiConfig?.titulo?.trim() || "Caca aos Bixos";

  useEffect(() => {
    setCoverSrc(turmaCover);
  }, [turmaCover]);

  if (authLoading || loadingAlbum || loadingTurma) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-emerald-500 font-black animate-pulse">
        Carregando...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-32">
      <header className="p-4 sm:p-6 sticky top-0 z-50 bg-[#050505]/95 backdrop-blur-md border-b border-white/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/album" className="p-2 bg-zinc-900 rounded-full shrink-0">
              <ArrowLeft size={20} />
            </Link>
            <h1 className="text-base sm:text-xl font-black uppercase italic truncate">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setShowMyQr(true)}
              className="bg-white text-black px-3 py-2 rounded-2xl shadow-lg active:scale-95 transition text-[11px] font-black uppercase tracking-wide inline-flex items-center gap-2"
            >
              <QrCode size={16} />
              Meu QR
            </button>
            <button
              disabled={processingScan}
              onClick={() => setShowScanner(true)}
              className="bg-emerald-600 text-white px-3 py-2 rounded-2xl shadow-emerald-500/20 shadow-lg active:scale-95 transition disabled:opacity-60 disabled:cursor-not-allowed text-[11px] font-black uppercase tracking-wide inline-flex items-center gap-2"
            >
              <ScanLine size={16} />
              Ler QR
            </button>
          </div>
        </div>
      </header>

      <div className="relative h-52 sm:h-56 w-full mb-6 sm:mb-8 overflow-hidden group">
        <Image
          src={coverSrc || turmaCover}
          fill
          className="object-cover opacity-60"
          alt="Capa Turma"
          
          priority
          sizes="100vw"
          onError={() => {
            if (coverSrc === turmaMeta.capa) {
              setCoverSrc("/logo.png");
              return;
            }
            setCoverSrc(turmaMeta.capa);
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent" />
        <div className="absolute bottom-4 sm:bottom-6 left-4 sm:left-6 right-4 sm:right-6 flex justify-between items-end gap-3 z-10">
          <div className="min-w-0">
            <h2 className="text-3xl sm:text-4xl font-black uppercase italic tracking-tighter leading-none break-words">
              {turmaTitle}
            </h2>
            <div className="flex items-center gap-2 mt-2">
              <Sparkles size={14} className="text-emerald-500 shrink-0" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest truncate">
                {turmaSubtitle}
              </span>
            </div>
          </div>
          <div className="bg-gradient-to-br from-amber-300 via-yellow-500 to-amber-600 p-[1px] rounded-2xl shadow-[0_0_20px_rgba(234,179,8,0.2)] shrink-0">
            <div className="bg-black/90 backdrop-blur-md px-3 sm:px-4 py-2 rounded-2xl flex flex-col items-center">
              <span className="text-[9px] font-black text-yellow-500 uppercase tracking-tighter">
                Capturados
              </span>
              <div className="text-lg sm:text-xl font-black text-white italic leading-none mt-1">
                {statsTurma.pegos}
                <span className="text-yellow-500/50 mx-1">/</span>
                {statsTurma.total}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="px-4 grid grid-cols-1 gap-6 max-w-3xl mx-auto">
        {usuarios.map((u) => {
          const isColada = meuAlbum.includes(u.id);
          const profileHref = tenantSlug.trim()
            ? withTenantSlug(tenantSlug, `/perfil/${u.id}`)
            : `/perfil/${u.id}`;
          return (
            <div
              key={u.id}
              className={`group relative rounded-[2.2rem] border transition-all duration-500 overflow-hidden ${
                isColada
                  ? "bg-zinc-900/80 border-emerald-500/40 shadow-2xl cursor-pointer hover:border-emerald-400/80 hover:-translate-y-0.5 hover:shadow-[0_20px_60px_rgba(16,185,129,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
                  : "bg-zinc-950 border-white/5 grayscale brightness-50 opacity-40"
              }`}
              role={isColada ? "link" : undefined}
              tabIndex={isColada ? 0 : undefined}
              title={isColada ? `Visitar perfil de ${u.apelido || u.nome}` : undefined}
              onClick={
                isColada
                  ? () => {
                      router.push(profileHref);
                    }
                  : undefined
              }
              onKeyDown={
                isColada
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(profileHref);
                      }
                    }
                  : undefined
              }
            >
              {isColada && (
                <div className="pointer-events-none absolute right-4 top-4 z-20 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300 opacity-0 translate-y-1 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                  Visitar perfil
                </div>
              )}
              <div className="p-5 sm:p-6 flex items-center gap-4 sm:gap-6">
                <div
                  className={`relative shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 transition-all duration-700 overflow-hidden ${
                    isColada
                      ? "border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.5)] scale-105"
                      : "border-zinc-800"
                  }`}
                >
                  <Image
                    src={u.foto || DEFAULT_AVATAR}
                    alt={u.nome}
                    fill
                    className="object-cover"
                    
                    sizes="96px"
                  />
                  {isColada && (
                    <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-black p-1.5 rounded-full shadow-lg z-10">
                      <CheckCircle2 size={14} fill="white" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3
                    className={`text-lg sm:text-xl font-black uppercase italic leading-none truncate ${
                      isColada ? "text-white" : "text-zinc-700"
                    }`}
                  >
                    {u.apelido || u.nome}
                  </h3>

                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-[9px] font-black bg-zinc-800 px-2 py-0.5 rounded text-zinc-400 uppercase">
                      {u.turma}
                    </span>

                    {isColada && (
                      <>
                        <span className="text-[9px] font-black bg-emerald-500/10 px-2 py-0.5 rounded text-emerald-500 uppercase">
                          {u.idadePublica === false ? "??" : calcularIdade(u.dataNascimento)} anos
                        </span>

                        {u.pets && u.pets !== "nenhum" && (
                          <span className="text-[9px] font-black bg-orange-500/10 px-2 py-0.5 rounded text-orange-500 uppercase flex items-center gap-1">
                            <PawPrint size={10} />
                            {u.pets === "cachorro" && "Dog"}
                            {u.pets === "gato" && "Cat"}
                            {u.pets === "ambos" && "Zoo"}
                          </span>
                        )}

                        <span className="text-[9px] font-black bg-emerald-500/10 px-2 py-0.5 rounded text-emerald-500 uppercase flex items-center gap-1">
                          <MapPin size={8} /> {u.cidadeOrigem || "?"}
                        </span>

                        {u.relacionamentoPublico && u.statusRelacionamento && (
                          <span className="text-[9px] font-black bg-pink-500/10 px-2 py-0.5 rounded text-pink-500 uppercase flex items-center gap-1">
                            <Heart
                              size={8}
                              fill={u.statusRelacionamento !== "Solteiro(a)" ? "currentColor" : "none"}
                            />
                            {u.statusRelacionamento}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {isColada && Array.isArray(u.esportes) && u.esportes.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {u.esportes.slice(0, 3).map((sport) => {
                        const info = resolveSportInfo(sport);
                        return (
                          <span
                            key={`${u.id}:${info.id}`}
                            className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide ${info.colorClass}`}
                          >
                            <span className="text-xs leading-none">{info.emoji}</span>
                            <span className="truncate">{info.label}</span>
                          </span>
                        );
                      })}
                      {u.esportes.length > 3 && (
                        <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-zinc-400">
                          +{u.esportes.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {isColada ? (
                    <div className="mt-3">
                      <p className="text-zinc-400 text-[11px] line-clamp-2 font-medium italic">
                        &quot;{u.bio || "..."}&quot;
                      </p>
                      {u.instagram && (
                        <a
                          href={`https://instagram.com/${u.instagram.replace("@", "")}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          className="inline-flex items-center gap-1.5 mt-2 text-pink-500 text-[10px] font-black uppercase hover:underline"
                        >
                          <Instagram size={12} /> @{u.instagram.replace("@", "")}
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-4 text-zinc-800">
                      <Lock size={12} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Bloqueado</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {usuarios.length === 0 && (
          <div className="text-center text-zinc-600 font-bold uppercase py-10">
            Ninguem dessa turma ainda.
          </div>
        )}

        {hasMoreUsers && (
          <div className="flex justify-center pt-2">
            <button
              onClick={() => {
                void loadMoreUsers();
              }}
              disabled={loadingMoreUsers}
              className="px-5 py-2.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-60 text-[11px] font-black uppercase tracking-wide"
            >
              {loadingMoreUsers ? "Carregando..." : "Carregar mais 20"}
            </button>
          </div>
        )}
      </main>

      {!showScanner && (
        <button
          onClick={() => setShowScanner(true)}
          className="fixed right-5 bottom-28 z-40 w-14 h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_12px_30px_rgba(16,185,129,0.35)] border border-emerald-400/30 flex items-center justify-center"
          aria-label="Abrir leitor de QR"
        >
          <ScanLine size={22} />
        </button>
      )}

      {showScanner && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-in fade-in duration-300">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-green-400 to-emerald-500 z-50 animate-pulse" />
          <div className="flex-1 relative flex items-center justify-center bg-black">
            <div id="reader" className="w-full h-full max-w-lg overflow-hidden" />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-64 h-64 border-4 border-emerald-500/50 rounded-3xl relative" />
            </div>

            <button
              onClick={() => {
                setShowScanner(false);
                void stopScanner();
              }}
              className="absolute top-6 right-6 bg-black/50 text-white p-3 rounded-full backdrop-blur-md z-50 border border-white/10"
            >
              <X size={24} />
            </button>

            <div className="absolute bottom-0 left-0 right-0 z-50 bg-gradient-to-t from-black via-black/95 to-transparent p-4 border-t border-white/10">
              <div className="max-w-lg mx-auto space-y-3">
                <p className="text-[11px] text-zinc-400 font-bold uppercase tracking-wide">
                  Aponte a camera para o QR e aguarde a leitura automatica.
                </p>
                {processingScan && (
                  <p className="text-[11px] text-emerald-400 font-bold uppercase">
                    Processando captura...
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showMyQr && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-6"
          onClick={() => setShowMyQr(false)}
        >
          <div
            className="bg-zinc-900 w-full max-w-sm rounded-[3rem] p-8 border border-emerald-500/30 text-center relative shadow-[0_0_50px_rgba(16,185,129,0.2)]"
            onClick={(event) => event.stopPropagation()}
          >
            <button onClick={() => setShowMyQr(false)} className="absolute top-6 right-6 text-zinc-500">
              <X size={24} />
            </button>
            <div className="w-24 h-24 rounded-full border-4 border-emerald-500 mx-auto mb-4 overflow-hidden shadow-xl relative">
              <Image
                src={user?.foto || DEFAULT_AVATAR}
                fill
                className="object-cover"
                alt="Meu Avatar"
                
                sizes="96px"
              />
            </div>
            <h2 className="text-2xl font-black uppercase italic mb-1 text-white">Meu Shark Code</h2>
            <div className="bg-white p-4 rounded-[2rem] inline-block my-6 shadow-inner">
              <QRCodeSVG value={user?.uid || ""} size={220} />
            </div>
            <p className="text-[10px] text-emerald-500 font-black uppercase tracking-widest bg-emerald-500/10 py-2 rounded-xl border border-emerald-500/20 break-all px-2">
              ID: {user?.uid || "usuario-nao-autenticado"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}



