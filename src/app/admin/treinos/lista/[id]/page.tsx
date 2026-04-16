"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  Download,
  ExternalLink,
  Loader2,
  QrCode,
  Search,
  ScanLine,
  Star,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";

import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  addUserToChamada,
  deleteChamadaEntry,
  fetchTreinoById,
  fetchTreinoChamadaPage,
  fetchTreinoRsvpsPage,
  fetchTreinoUserPresenceProfile,
  fetchUserDirectorySegmentUsers,
  fetchUserDirectorySegments,
  searchUserDirectoryByName,
  type TreinoChamadaRecord,
  type TreinoRsvpRecord,
  type TreinoUserDirectoryItem,
  type TreinoUserDirectorySegment,
  upsertChamadaPresence,
  updateChamadaPerformanceRating,
  updateChamadaStatus,
} from "@/lib/treinosNativeService";
import { isPermissionError } from "@/lib/backendErrors";
import { withTenantSlug } from "@/lib/tenantRouting";

const PAGE_SIZE = 10;

const mergeUniqueById = <T extends { id?: string; userId: string }>(
  current: T[],
  next: T[]
): T[] => {
  if (!next.length) return current;
  const ids = new Set(current.map((row) => `${row.id || row.userId}:${row.userId}`));
  const merged = [...current];

  next.forEach((row) => {
    const key = `${row.id || row.userId}:${row.userId}`;
    if (ids.has(key)) return;
    ids.add(key);
    merged.push(row);
  });

  return merged;
};

type TreinoPresenceQrPayload = {
  treinoId: string;
  userId: string;
  userName: string;
  userTurma: string;
  userAvatar: string;
  tenantId: string;
};

const asPayloadString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const parseTreinoPresenceQrPayload = (rawPayload: string): TreinoPresenceQrPayload | null => {
  let candidate = rawPayload.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    candidate =
      url.searchParams.get("treinoQr") ||
      url.searchParams.get("payload") ||
      url.searchParams.get("qr") ||
      candidate;
  } catch {
    // QR local usa JSON direto.
  }

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const type = asPayloadString(parsed.t || parsed.type);
    const treinoId = asPayloadString(parsed.tid || parsed.treinoId);
    const userId = asPayloadString(parsed.uid || parsed.userId);
    if (type && type !== "treino-presenca") return null;
    if (!treinoId || !userId) return null;

    return {
      treinoId,
      userId,
      userName: asPayloadString(parsed.n || parsed.userName || parsed.nome) || "Atleta",
      userTurma: asPayloadString(parsed.tu || parsed.userTurma || parsed.turma) || "Geral",
      userAvatar: asPayloadString(parsed.av || parsed.userAvatar || parsed.avatar),
      tenantId: asPayloadString(parsed.ten || parsed.tenantId),
    };
  } catch {
    return null;
  }
};

export default function AdminTreinoListaPage() {
  const params = useParams<{ id: string }>();
  const treinoId = params?.id?.trim() || "";

  const { addToast } = useToast();
  const { user } = useAuth();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin/treinos") : "/admin/treinos";

  const [titulo, setTitulo] = useState("Treino");
  const [subtitulo, setSubtitulo] = useState("-");

  const [chamadaRows, setChamadaRows] = useState<TreinoChamadaRecord[]>([]);
  const [rsvpRows, setRsvpRows] = useState<TreinoRsvpRecord[]>([]);

  const [loading, setLoading] = useState(true);

  const [chamadaCursor, setChamadaCursor] = useState<string | null>(null);
  const [rsvpCursor, setRsvpCursor] = useState<string | null>(null);
  const [hasMoreChamada, setHasMoreChamada] = useState(false);
  const [hasMoreRsvp, setHasMoreRsvp] = useState(false);

  const [loadingMoreChamada, setLoadingMoreChamada] = useState(false);
  const [loadingMoreRsvp, setLoadingMoreRsvp] = useState(false);

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingScanRef = useRef(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerStarting, setScannerStarting] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [scanError, setScanError] = useState("");

  const [userPool, setUserPool] = useState<TreinoUserDirectoryItem[]>([]);
  const [userSegments, setUserSegments] = useState<TreinoUserDirectorySegment[]>(
    []
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [remoteUserSuggestions, setRemoteUserSuggestions] = useState<
    TreinoUserDirectoryItem[]
  >([]);
  const [loadingSegments, setLoadingSegments] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [searchUser, setSearchUser] = useState("");
  const selectedUserSegment = useMemo(
    () => userSegments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [selectedSegmentId, userSegments]
  );

  const loadInitial = useCallback(async () => {
    if (!treinoId) return;
    setLoading(true);

    try {
      const [treino, chamadaPage, rsvpPage] = await Promise.all([
        fetchTreinoById(treinoId, {
          forceRefresh: false,
          tenantId: activeTenantId || undefined,
        }),
        fetchTreinoChamadaPage(treinoId, {
          pageSize: PAGE_SIZE,
          forceRefresh: false,
          tenantId: activeTenantId || undefined,
        }),
        fetchTreinoRsvpsPage(treinoId, {
          pageSize: PAGE_SIZE,
          forceRefresh: false,
          tenantId: activeTenantId || undefined,
        }),
      ]);

      if (treino) {
        setTitulo(treino.modalidade || "Treino");
        setSubtitulo(`${treino.dia || "-"} â€¢ ${treino.horario || "-"} â€¢ ${treino.local || "-"}`);
      }

      setChamadaRows(chamadaPage.rows);
      setRsvpRows(rsvpPage.rows);
      setChamadaCursor(chamadaPage.nextCursor);
      setRsvpCursor(rsvpPage.nextCursor);
      setHasMoreChamada(chamadaPage.hasMore);
      setHasMoreRsvp(rsvpPage.hasMore);
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao carregar lista de presenÃ§a.", "error");
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, addToast, treinoId]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadUserSegments = useCallback(
    async (forceRefresh = false) => {
      setLoadingSegments(true);
      try {
        const segments = await fetchUserDirectorySegments({
          forceRefresh,
          maxUsersPerSegment: 30,
          tenantId: activeTenantId || undefined,
        });
        setUserSegments(segments);
        setSelectedSegmentId((current) =>
          segments.some((segment) => segment.id === current)
            ? current
            : segments[0]?.id || ""
        );
      } catch (error: unknown) {
        if (!isPermissionError(error)) {
          console.error(error);
        }
        addToast("Erro ao montar grupos de usuarios.", "error");
      } finally {
        setLoadingSegments(false);
      }
    },
    [activeTenantId, addToast]
  );

  const loadUsersFromSegment = useCallback(
    async (segment: TreinoUserDirectorySegment) => {
      setLoadingUsers(true);
      try {
        const users = await fetchUserDirectorySegmentUsers({
          segment,
          tenantId: activeTenantId || undefined,
        });
        setUserPool(users);
      } catch (error: unknown) {
        if (!isPermissionError(error)) {
          console.error(error);
        }
        addToast("Erro ao carregar grupo de usuarios.", "error");
      } finally {
        setLoadingUsers(false);
      }
    },
    [activeTenantId, addToast]
  );

  useEffect(() => {
    void loadUserSegments();
  }, [loadUserSegments]);

  useEffect(() => {
    if (!selectedUserSegment) {
      setUserPool([]);
      return;
    }
    void loadUsersFromSegment(selectedUserSegment);
  }, [loadUsersFromSegment, selectedUserSegment]);

  const inscritosPendentes = useMemo(() => {
    const presentes = new Set(chamadaRows.map((row) => row.userId));
    return rsvpRows.filter((row) => row.status === "going" && !presentes.has(row.userId));
  }, [rsvpRows, chamadaRows]);

  const confirmadosCount = useMemo(
    () => rsvpRows.filter((row) => row.status === "going").length,
    [rsvpRows]
  );

  const presentesCount = useMemo(
    () => chamadaRows.filter((row) => row.status === "presente").length,
    [chamadaRows]
  );

  const userSuggestions = useMemo(() => {
    const term = searchUser.trim().toLowerCase();
    if (!term) return [];
    if (term.length >= 2) {
      return remoteUserSuggestions.slice(0, 8);
    }
    return userPool.filter((row) => row.nome.toLowerCase().includes(term)).slice(0, 8);
  }, [remoteUserSuggestions, searchUser, userPool]);

  useEffect(() => {
    const term = searchUser.trim();
    if (term.length < 2) {
      setRemoteUserSuggestions([]);
      setSearchingUsers(false);
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(() => {
      setSearchingUsers(true);
      void searchUserDirectoryByName({
        query: term,
        maxResults: 8,
        tenantId: activeTenantId || undefined,
      })
        .then((users) => {
          if (!active) return;
          setRemoteUserSuggestions(users);
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (!isPermissionError(error)) {
            console.error(error);
          }
          setRemoteUserSuggestions([]);
        })
        .finally(() => {
          if (active) {
            setSearchingUsers(false);
          }
        });
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [activeTenantId, searchUser]);

  const stopTreinoScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;

    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
    } catch {
      // scanner ja estava parado
    }
    try {
      await scanner.clear();
    } catch {
      // noop
    }
    scannerRef.current = null;
    processingScanRef.current = false;
  }, []);

  const processTreinoQrScan = useCallback(
    async (decodedText: string) => {
      if (processingScanRef.current) return;
      processingScanRef.current = true;
      setScanError("");
      setScanMessage("Validando QR do treino...");

      try {
        const payload = parseTreinoPresenceQrPayload(decodedText);
        if (!payload) {
          throw new Error("QR invalido para chamada de treino.");
        }
        if (payload.treinoId !== treinoId) {
          throw new Error("Este QR pertence a outro treino.");
        }
        if (payload.tenantId && activeTenantId && payload.tenantId !== activeTenantId) {
          throw new Error("Este QR pertence a outra tenant.");
        }

        const profile = await fetchTreinoUserPresenceProfile(payload.userId, {
          tenantId: activeTenantId || undefined,
        });
        const aluno = profile ?? {
          uid: payload.userId,
          nome: payload.userName || "Atleta",
          turma: payload.userTurma || "Geral",
          foto: payload.userAvatar || "",
          email: "",
        };

        await upsertChamadaPresence({
          treinoId,
          userId: aluno.uid,
          nome: aluno.nome,
          turma: aluno.turma || "Geral",
          avatar: aluno.foto || "",
          origem: "app",
          status: "presente",
          tenantId: activeTenantId || undefined,
        });

        const nextRow: TreinoChamadaRecord = {
          id: `${treinoId}:${aluno.uid}`,
          userId: aluno.uid,
          nome: aluno.nome,
          avatar: aluno.foto,
          turma: aluno.turma || "Geral",
          status: "presente",
          origem: "app",
        };
        setChamadaRows((prev) => {
          const hasRow = prev.some((entry) => entry.userId === aluno.uid);
          if (hasRow) {
            return prev.map((entry) =>
              entry.userId === aluno.uid ? { ...entry, ...nextRow, id: entry.id || nextRow.id } : entry
            );
          }
          return [nextRow, ...prev];
        });
        setScanMessage(`${aluno.nome} confirmado na chamada.`);
        addToast("Presenca registrada pelo QR.", "success");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Falha ao ler QR do treino.";
        setScanError(message);
        setScanMessage("");
        addToast(message, "error");
      } finally {
        window.setTimeout(() => {
          processingScanRef.current = false;
          setScanMessage((current) => (current.includes("confirmado") ? "" : current));
        }, 1400);
      }
    },
    [activeTenantId, addToast, treinoId]
  );

  useEffect(() => {
    if (!showScanner || scannerRef.current) return;

    let mounted = true;
    const start = async () => {
      setScannerStarting(true);
      setScanError("");
      setScanMessage("");
      try {
        const html5QrCode = new Html5Qrcode("treino-presence-reader");
        scannerRef.current = html5QrCode;
        const cameras = await Html5Qrcode.getCameras().catch(() => []);
        const preferredCamera =
          cameras.find((camera) => /back|rear|traseira|environment/i.test(camera.label)) ||
          cameras[0];
        const sources: Array<string | { facingMode: string }> = [];
        if (preferredCamera?.id) sources.push(preferredCamera.id);
        sources.push({ facingMode: "environment" });
        sources.push({ facingMode: "user" });

        const scannerConfig = {
          fps: 12,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.max(1, Math.min(viewfinderWidth, viewfinderHeight));
            const size = Math.min(320, Math.max(220, Math.floor(minEdge * 0.72)));
            return { width: size, height: size };
          },
          disableFlip: false,
        };

        let started = false;
        for (const source of sources) {
          try {
            await html5QrCode.start(
              source,
              scannerConfig,
              (decodedText) => {
                void processTreinoQrScan(decodedText);
              },
              () => undefined
            );
            started = true;
            break;
          } catch {
            // tenta a proxima camera disponivel
          }
        }
        if (!started) throw new Error("camera-not-found");
      } catch (error: unknown) {
        if (!mounted) return;
        console.error(error);
        setScanError("Nao foi possivel abrir a camera neste aparelho.");
        await stopTreinoScanner();
      } finally {
        if (mounted) setScannerStarting(false);
      }
    };

    void start();
    return () => {
      mounted = false;
      void stopTreinoScanner();
    };
  }, [processTreinoQrScan, showScanner, stopTreinoScanner]);

  const handleLoadMoreChamada = async () => {
    if (!treinoId || !hasMoreChamada || !chamadaCursor || loadingMoreChamada) return;
    setLoadingMoreChamada(true);
    try {
      const page = await fetchTreinoChamadaPage(treinoId, {
        pageSize: PAGE_SIZE,
        cursorId: chamadaCursor,
        forceRefresh: false,
        tenantId: activeTenantId || undefined,
      });
      setChamadaRows((prev) => mergeUniqueById(prev, page.rows));
      setChamadaCursor(page.nextCursor);
      setHasMoreChamada(page.hasMore);
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao carregar mais chamada.", "error");
    } finally {
      setLoadingMoreChamada(false);
    }
  };

  const handleLoadMoreRsvp = async () => {
    if (!treinoId || !hasMoreRsvp || !rsvpCursor || loadingMoreRsvp) return;
    setLoadingMoreRsvp(true);
    try {
      const page = await fetchTreinoRsvpsPage(treinoId, {
        pageSize: PAGE_SIZE,
        cursorId: rsvpCursor,
        forceRefresh: false,
        tenantId: activeTenantId || undefined,
      });
      setRsvpRows((prev) => mergeUniqueById(prev, page.rows));
      setRsvpCursor(page.nextCursor);
      setHasMoreRsvp(page.hasMore);
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao carregar mais inscritos.", "error");
    } finally {
      setLoadingMoreRsvp(false);
    }
  };

  const handleTogglePresence = async (row: TreinoChamadaRecord) => {
    if (!treinoId) return;

    const nextStatus = row.status === "presente" ? "falta" : "presente";
    setUpdatingId(row.id);
    try {
      await updateChamadaStatus({
        treinoId,
        chamadaId: row.id,
        status: nextStatus,
        tenantId: activeTenantId || undefined,
      });

      setChamadaRows((prev) =>
        prev.map((entry) =>
          entry.id === row.id ? { ...entry, status: nextStatus } : entry
        )
      );
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao atualizar presenÃ§a.", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRatePerformance = async (row: TreinoChamadaRecord, rating: number) => {
    if (!treinoId) return;

    setUpdatingId(`${row.id}:rating`);
    try {
      await updateChamadaPerformanceRating({
        treinoId,
        chamadaId: row.id,
        rating,
        ratedBy: user?.nome || user?.email || "Admin",
        tenantId: activeTenantId || undefined,
      });
      setChamadaRows((prev) =>
        prev.map((entry) =>
          entry.id === row.id
            ? {
                ...entry,
                performanceRating: rating,
                performanceRatedBy: user?.nome || user?.email || "Admin",
                performanceRatedAt: new Date().toISOString(),
              }
            : entry
        )
      );
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao salvar desempenho.", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRemoveFromChamada = async (row: TreinoChamadaRecord) => {
    if (!treinoId) return;

    const confirmed = window.confirm("Remover aluno da chamada?");
    if (!confirmed) return;

    setDeletingId(row.id);
    try {
      await deleteChamadaEntry({
        treinoId,
        chamadaId: row.id,
        tenantId: activeTenantId || undefined,
      });
      setChamadaRows((prev) => prev.filter((entry) => entry.id !== row.id));
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao remover aluno.", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const handleConfirmPendingRsvp = async (row: TreinoRsvpRecord) => {
    if (!treinoId) return;

    setUpdatingId(row.userId);
    try {
      await upsertChamadaPresence({
        treinoId,
        userId: row.userId,
        nome: row.userName,
        turma: row.userTurma,
        avatar: row.userAvatar,
        origem: "app",
        status: "presente",
        tenantId: activeTenantId || undefined,
      });

      setChamadaRows((prev) =>
        mergeUniqueById(prev, [
          {
            id: row.userId,
            userId: row.userId,
            nome: row.userName,
            avatar: row.userAvatar,
            turma: row.userTurma,
            status: "presente",
            origem: "app",
          },
        ])
      );
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao confirmar inscrito.", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAddUser = async (user: TreinoUserDirectoryItem) => {
    if (!treinoId) return;

    setUpdatingId(user.uid);
    try {
      await addUserToChamada({
        treinoId,
        user,
        tenantId: activeTenantId || undefined,
      });
      setChamadaRows((prev) =>
        mergeUniqueById(prev, [
          {
            id: user.uid,
            userId: user.uid,
            nome: user.nome,
            turma: user.turma,
            avatar: user.foto,
            status: "presente",
            origem: "manual",
          },
        ])
      );
      setSearchUser("");
    } catch (error: unknown) {
      if (!isPermissionError(error)) { console.error(error); }
      addToast("Erro ao adicionar aluno.", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  const getRsvpStatusLabel = (status: TreinoRsvpRecord["status"]): string =>
    status === "going" ? "Vou" : "Nao vou";

  const handleExportCsv = () => {
    if (!chamadaRows.length) {
      addToast("Nenhum aluno carregado na chamada.", "info");
      return;
    }

    const headers = ["Nome", "Turma", "Status", "Origem", "Desempenho"];
    const rows = chamadaRows.map((row) => [
      row.nome,
      row.turma,
      row.status,
      row.origem,
      row.performanceRating ? `${row.performanceRating}/5` : "",
    ]);

    const csvContent = [headers.join(","), ...rows.map((line) => line.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `chamada_${treinoId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Lista de PresenÃ§a</h1>
              <p className="text-[11px] text-zinc-500 font-bold">
                {titulo} â€¢ {subtitulo}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase">
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
                  {confirmadosCount} confirmados
                </span>
                <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-sky-300">
                  {presentesCount} presentes
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={() => setShowScanner(true)}
              className="px-3 py-2 rounded-lg bg-emerald-500 text-black border border-emerald-400 text-xs font-black uppercase flex items-center gap-2"
            >
              <QrCode size={14} /> Ler QR
            </button>
            <button
              onClick={handleExportCsv}
              className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 text-xs font-black uppercase flex items-center gap-2"
            >
              <Download size={14} /> CSV
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 space-y-5">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="animate-spin text-emerald-500" />
          </div>
        ) : (
          <>
            <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <div>
                  <h2 className="text-xs font-black uppercase text-zinc-400">
                    Adicionar Aluno Manualmente
                  </h2>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    Faixas dinamicas com ate 30 usuarios por grupo
                  </p>
                </div>
                <button
                  onClick={() => void loadUserSegments(true)}
                  disabled={loadingSegments}
                  className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-200 text-[11px] font-black uppercase disabled:opacity-50"
                >
                  {loadingSegments ? "Atualizando grupos..." : "Atualizar grupos"}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {userSegments.length === 0 ? (
                  <span className="text-[11px] text-zinc-500">
                    Nenhum grupo disponivel.
                  </span>
                ) : (
                  userSegments.map((segment) => (
                    <button
                      key={segment.id}
                      onClick={() => setSelectedSegmentId(segment.id)}
                      className={`rounded-full border px-3 py-2 text-[11px] font-black uppercase transition ${
                        selectedSegmentId === segment.id
                          ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                          : "border-zinc-700 bg-black text-zinc-300 hover:border-zinc-500"
                      }`}
                    >
                      {segment.label} ({segment.count})
                    </button>
                  ))
                )}
              </div>

              {selectedUserSegment ? (
                <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                  {loadingUsers
                    ? "Carregando usuarios do grupo..."
                    : `Grupo ativo: ${selectedUserSegment.label} • ${selectedUserSegment.count} usuarios`}
                </div>
              ) : null}

              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={searchUser}
                  onChange={(event) => setSearchUser(event.target.value)}
                  placeholder="Buscar aluno por nome"
                  className="w-full bg-black border border-zinc-700 rounded-xl py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-emerald-500"
                />

                {searchUser.trim() && (userSuggestions.length > 0 || searchingUsers) && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden z-20">
                    {searchingUsers && (
                      <div className="px-3 py-2 text-xs text-zinc-400 flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin" />
                        Buscando usuarios...
                      </div>
                    )}
                    {userSuggestions.map((row) => (
                      <button
                        key={row.uid}
                        onClick={() => void handleAddUser(row)}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-zinc-800 flex items-center justify-between"
                      >
                        <span>
                          {row.nome}
                          <span className="ml-2 text-zinc-500">{row.turma || "-"}</span>
                        </span>
                        <UserPlus size={14} className="text-zinc-400" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 text-xs font-black uppercase text-zinc-400">
                Chamada Oficial ({chamadaRows.length} carregados)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-black/40 text-zinc-500 uppercase font-black">
                    <tr>
                      <th className="p-4">Aluno</th>
                      <th className="p-4">Turma</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Origem</th>
                      <th className="p-4">Desempenho</th>
                      <th className="p-4 text-right">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-200">
                    {chamadaRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-zinc-500">
                          Nenhum aluno na chamada.
                        </td>
                      </tr>
                    ) : (
                      chamadaRows.map((row) => (
                        <tr key={`${row.id}:${row.userId}`} className="hover:bg-zinc-800/40">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <div className="relative w-7 h-7 rounded-full overflow-hidden border border-zinc-700 bg-zinc-800">
                                <Image
                                  src={row.avatar || "https://github.com/shadcn.png"}
                                  alt={row.nome}
                                  fill
                                  className="object-cover"
                                  
                                />
                              </div>
                              <span className="font-bold text-white">{row.nome}</span>
                              <Link
                                href={`/admin/usuarios/${row.userId}`}
                                target="_blank"
                                className="text-zinc-500 hover:text-emerald-400"
                                title="Abrir perfil"
                              >
                                <ExternalLink size={12} />
                              </Link>
                            </div>
                          </td>
                          <td className="p-4">{row.turma || "-"}</td>
                          <td className="p-4 uppercase font-black text-[10px]">{row.status}</td>
                          <td className="p-4 uppercase font-black text-[10px]">{row.origem}</td>
                          <td className="p-4">
                            <div className="flex items-center gap-1" aria-label={`Desempenho ${row.performanceRating || 0} de 5`}>
                              {[1, 2, 3, 4, 5].map((rating) => (
                                <button
                                  key={rating}
                                  type="button"
                                  onClick={() => void handleRatePerformance(row, rating)}
                                  disabled={updatingId === `${row.id}:rating`}
                                  className="rounded-md p-1 text-zinc-600 transition hover:text-yellow-300 disabled:opacity-50"
                                  title={`${rating} estrela${rating > 1 ? "s" : ""}`}
                                >
                                  <Star
                                    size={15}
                                    className={
                                      rating <= Math.max(0, row.performanceRating || 0)
                                        ? "fill-yellow-400 text-yellow-400"
                                        : "text-zinc-600"
                                    }
                                  />
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => void handleTogglePresence(row)}
                                disabled={updatingId === row.id}
                                className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 disabled:opacity-50"
                                title="Alternar presente/falta"
                              >
                                {updatingId === row.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : row.status === "presente" ? (
                                  <X size={14} className="text-red-400" />
                                ) : (
                                  <CheckCircle size={14} className="text-emerald-400" />
                                )}
                              </button>

                              <button
                                onClick={() => void handleRemoveFromChamada(row)}
                                disabled={deletingId === row.id}
                                className="p-2 rounded-lg bg-red-900/20 border border-red-700/40 text-red-300 disabled:opacity-50"
                                title="Remover da chamada"
                              >
                                {deletingId === row.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Trash2 size={14} />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 text-xs font-black uppercase text-zinc-400">
                Inscritos no App sem chamada confirmada ({inscritosPendentes.length} carregados)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-black/40 text-zinc-500 uppercase font-black">
                    <tr>
                      <th className="p-4">Aluno</th>
                      <th className="p-4">Turma</th>
                      <th className="p-4">Status RSVP</th>
                      <th className="p-4 text-right">Confirmar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-200">
                    {inscritosPendentes.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-zinc-500">
                          Nenhum inscrito pendente carregado.
                        </td>
                      </tr>
                    ) : (
                      inscritosPendentes.map((row) => (
                        <tr key={row.userId} className="hover:bg-zinc-800/40">
                          <td className="p-4 font-bold text-white">{row.userName}</td>
                          <td className="p-4">{row.userTurma || "-"}</td>
                          <td className="p-4 uppercase font-black text-[10px]">
                            {getRsvpStatusLabel(row.status)}
                          </td>
                          <td className="p-4">
                            <div className="flex justify-end">
                              <button
                                onClick={() => void handleConfirmPendingRsvp(row)}
                                disabled={updatingId === row.userId}
                                className="p-2 rounded-lg bg-emerald-600 text-white border border-emerald-500 disabled:opacity-50"
                                title="Confirmar presenÃ§a"
                              >
                                {updatingId === row.userId ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <CheckCircle size={14} />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => void handleLoadMoreChamada()}
                disabled={!hasMoreChamada || loadingMoreChamada}
                className="py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase tracking-wide hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loadingMoreChamada ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Carregando chamada
                  </>
                ) : (
                  <>
                    <ChevronDown size={15} /> Carregar mais chamada (10)
                  </>
                )}
              </button>

              <button
                onClick={() => void handleLoadMoreRsvp()}
                disabled={!hasMoreRsvp || loadingMoreRsvp}
                className="py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase tracking-wide hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loadingMoreRsvp ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Carregando inscritos
                  </>
                ) : (
                  <>
                    <ChevronDown size={15} /> Carregar mais inscritos (10)
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </main>

      {showScanner ? (
        <div className="fixed inset-0 z-[9999] flex h-[100dvh] flex-col bg-black text-white">
          <div className="flex items-center justify-between border-b border-white/10 bg-black/90 px-4 py-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-emerald-400">
                Leitor de presenca
              </p>
              <h2 className="text-sm font-black uppercase text-white">{titulo}</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowScanner(false);
                void stopTreinoScanner();
              }}
              className="rounded-full border border-white/15 bg-white/10 p-2 text-white"
              aria-label="Fechar leitor"
            >
              <X size={20} />
            </button>
          </div>

          <div className="relative min-h-0 flex-1 bg-black">
            <div id="treino-presence-reader" className="qr-reader-surface h-full w-full" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
              <div className="aspect-square w-[min(72vw,320px)] rounded-3xl border-4 border-emerald-400/70 shadow-[0_0_32px_rgba(16,185,129,0.35)]" />
            </div>
            {scannerStarting ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/75">
                <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-bold text-zinc-200">
                  <Loader2 size={16} className="animate-spin text-emerald-400" />
                  Abrindo camera...
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-white/10 bg-black/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-lg space-y-2">
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs font-black uppercase tracking-wide text-emerald-200">
                <ScanLine size={15} />
                Aponte para o QR aberto na pagina do treino
              </div>
              {scanMessage ? (
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200">
                  {scanMessage}
                </div>
              ) : null}
              {scanError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                  {scanError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

