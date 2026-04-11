// src/app/ligas/page.tsx
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useParams, usePathname, useRouter } from "next/navigation";
import { 
  Lock, ArrowRight, Upload, Plus, Trash2, Save, LogOut, 
  Image as ImageIcon, Layout, Edit3, Bell, 
  Calendar, UserPlus, Search, X, Users,
  Loader2, MessageCircle, LayoutGrid
} from 'lucide-react';
import Image from "next/image";
import { useToast } from "../../context/ToastContext";
import { ClientCache } from "@/lib/clientCache";
import {
  clearEventsNativeCaches,
  EVENT_POLL_OPTION_MAX_CHARS,
  EVENT_POLL_OPTION_MAX_COUNT,
  EVENT_POLL_QUESTION_MAX_CHARS,
} from "@/lib/eventsNativeService";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { logActivity } from "../../lib/logger"; 
import {
  createEventPoll,
  deleteEventPoll,
  fetchEventPolls,
  fetchLeagueById,
  fetchLeagueSummaries,
  fetchLeagueUsers,
  LEAGUE_NAME_MAX_LENGTH,
  syncLeagueEvents,
  syncLeagueMembers,
  uploadLeagueImageToStorage,
  updateEventPollOptions,
  type LeaguePollRecord,
} from "../../lib/leaguesService";
import { resolveLeagueLogoSrc } from "../../lib/leagueMedia";
import {
  DEFAULT_LEAGUE_ROLE,
  LEAGUE_ROLE_OPTIONS,
  resolveLeagueRoleLabel,
  sortLeagueMembersByRole,
} from "../../lib/leagueRoles";
import { withTenantSlug } from "@/lib/tenantRouting";

// --- TIPAGEM ESTRITA (Sem 'any') ---

interface UserSearch {
    id: string;
    nome: string;
    foto?: string;
    turma?: string;
}

interface PerguntaLiga { 
    id: string; 
    texto: string; 
    imageUrl?: string;
    alternativas: string[]; 
    correta: number; 
}

interface Member { 
    id: string; 
    nome: string; 
    cargo: string; 
    foto: string; 
    linkPerfil?: string; 
}

interface Lote { 
    id: number; 
    nome: string; 
    preco: string; 
    status: "ativo" | "encerrado" | "agendado"; 
}

interface NovoLoteDraft {
    nome: string;
    preco: string;
    status: "ativo" | "encerrado" | "agendado";
}

interface PollOption {
    text: string;
    votes: number;
    creator?: string;
    creatorName?: string;
    creatorAvatar?: string;
}

type Poll = LeaguePollRecord;

interface LeagueEvent { 
    id: string; 
    titulo: string; 
    data: string; 
    hora: string; 
    local: string; 
    tipo: string; 
    destaque: string; 
    imagem: string; 
    imagePositionY: number;
    lotes: Lote[]; 
    descricao: string; 
    linkEvento?: string; 
    globalEventId?: string;
    pollQuestion?: string; 
}

type LigaAdminTab = 'visual' | 'members' | 'events' | 'shark';

interface LigaData {
    id: string; 
    nome: string; 
    sigla: string; 
    descricao?: string; 
    bizu?: string; 
    likes?: number; 
    senha: string; 
    foto?: string;
    logoUrl?: string;
    ativa?: boolean; 
    perguntas: PerguntaLiga[]; 
    membros?: Member[]; 
    eventos?: LeagueEvent[];
    membrosIds?: string[];
    membersCount?: number;
    updatedAt?: string;
}

interface LigaEditorDraftSnapshot {
    version: 1;
    savedAt: number;
    ligaSenha: string;
    activeTab: LigaAdminTab;
    savedMemberIds?: string[];
    sendNotification: boolean;
    ligaDraft: Omit<LigaData, "senha">;
    eventModal: boolean;
    editingEventIdx: number | null;
    currentEvent: Partial<LeagueEvent>;
    novoLote: NovoLoteDraft;
}

const LIGA_EDITOR_DRAFT_VERSION = 1;
const LIGA_EDITOR_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const buildLigaEditorLastSelectedKey = (tenantScopeId?: string | null): string =>
    `usc:ligas:${tenantScopeId?.trim() || "default"}:last-selected`;

const getLigaEditorDraftKey = (ligaId: string, tenantScopeId?: string | null): string =>
    `usc:ligas:${tenantScopeId?.trim() || "default"}:draft:${ligaId}`;

const isLigaAdminTab = (value: unknown): value is LigaAdminTab => (
    value === "visual" || value === "members" || value === "events" || value === "shark"
);

const readSessionStorageValue = (key: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
        return window.sessionStorage.getItem(key);
    } catch {
        return null;
    }
};

const writeSessionStorageValue = (key: string, value: string): void => {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.setItem(key, value);
    } catch {
        // Ignora falhas de quota/privacidade sem quebrar o fluxo do editor.
    }
};

const removeSessionStorageValue = (key: string): void => {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.removeItem(key);
    } catch {
        // Sem ação; limpeza é best-effort.
    }
};

const readLigaEditorDraft = (ligaId: string, tenantScopeId?: string | null): LigaEditorDraftSnapshot | null => {
    const raw = readSessionStorageValue(getLigaEditorDraftKey(ligaId, tenantScopeId));
    if (!raw) return null;

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;

        const snapshot = parsed as Partial<LigaEditorDraftSnapshot>;
        if (snapshot.version !== LIGA_EDITOR_DRAFT_VERSION) return null;
        if (typeof snapshot.savedAt !== "number") return null;
        if (Date.now() - snapshot.savedAt > LIGA_EDITOR_DRAFT_TTL_MS) return null;
        if (!isLigaAdminTab(snapshot.activeTab)) return null;
        if (!snapshot.ligaDraft || typeof snapshot.ligaDraft !== "object") return null;

        return {
            version: LIGA_EDITOR_DRAFT_VERSION,
            savedAt: snapshot.savedAt,
            ligaSenha: typeof snapshot.ligaSenha === "string" ? snapshot.ligaSenha : "",
            activeTab: snapshot.activeTab,
            savedMemberIds: Array.isArray(snapshot.savedMemberIds)
                ? snapshot.savedMemberIds.filter((entry): entry is string => typeof entry === "string")
                : undefined,
            sendNotification: Boolean(snapshot.sendNotification),
            ligaDraft: snapshot.ligaDraft as Omit<LigaData, "senha">,
            eventModal: Boolean(snapshot.eventModal),
            editingEventIdx: typeof snapshot.editingEventIdx === "number" ? snapshot.editingEventIdx : null,
            currentEvent: snapshot.currentEvent && typeof snapshot.currentEvent === "object" ? snapshot.currentEvent : {},
            novoLote: snapshot.novoLote && typeof snapshot.novoLote === "object"
                ? {
                    nome: typeof snapshot.novoLote.nome === "string" ? snapshot.novoLote.nome : "",
                    preco: typeof snapshot.novoLote.preco === "string" ? snapshot.novoLote.preco : "",
                    status:
                        snapshot.novoLote.status === "encerrado" || snapshot.novoLote.status === "agendado"
                            ? snapshot.novoLote.status
                            : "ativo",
                }
                : { nome: "", preco: "", status: "ativo" },
        };
    } catch {
        return null;
    }
};

const writeLigaEditorDraft = (ligaId: string, snapshot: LigaEditorDraftSnapshot, tenantScopeId?: string | null): void => {
    writeSessionStorageValue(getLigaEditorDraftKey(ligaId, tenantScopeId), JSON.stringify(snapshot));
};

const clearLigaEditorDraft = (ligaId: string, tenantScopeId?: string | null): void => {
    removeSessionStorageValue(getLigaEditorDraftKey(ligaId, tenantScopeId));
};

const parseDateMs = (value: unknown): number => {
    if (typeof value !== "string" || !value.trim()) return 0;
    const parsed = new Date(value);
    const time = parsed.getTime();
    return Number.isFinite(time) ? time : 0;
};

const nowIso = (): string => new Date().toISOString();

const sanitizeQuestionDrafts = (questions: PerguntaLiga[]): PerguntaLiga[] =>
    questions.map((question) => {
        const imageUrl =
            typeof question.imageUrl === "string" && question.imageUrl.trim()
                ? question.imageUrl.trim()
                : undefined;

        return {
            id: question.id,
            texto: question.texto,
            ...(imageUrl ? { imageUrl } : {}),
            alternativas: Array.isArray(question.alternativas)
                ? question.alternativas.map((entry) => String(entry))
                : ["", "", "", ""],
            correta:
                typeof question.correta === "number" && Number.isFinite(question.correta)
                    ? Math.max(0, Math.min(3, Math.floor(question.correta)))
                    : 0,
        };
    });

const extractMemberIds = (members?: Member[]): string[] =>
    Array.from(
        new Set(
            (members || [])
                .map((member) => (typeof member.id === "string" ? member.id.trim() : ""))
                .filter((memberId) => memberId.length > 0)
        )
    );

const buildLeagueSectionPath = (tab: LigaAdminTab, leagueId?: string | null): string => {
    const cleanLeagueId = typeof leagueId === "string" ? leagueId.trim() : "";
    const basePath = cleanLeagueId
        ? `/ligas/${encodeURIComponent(cleanLeagueId)}`
        : "/ligas";

    if (tab === "members") return `${basePath}/membros`;
    if (tab === "events") return `${basePath}/eventos`;
    if (tab === "shark") return `${basePath}/board-round`;
    return cleanLeagueId ? `${basePath}/informacoes` : "/ligas/informacoes";
};

const resolveLeagueTabFromPathname = (pathname: string): LigaAdminTab => {
    const normalized = pathname.toLowerCase().replace(/\/+$/, "");
    if (/\/ligas\/[^/]+\/membros$/.test(normalized)) return "members";
    if (/\/ligas\/[^/]+\/eventos$/.test(normalized)) return "events";
    if (/\/ligas\/[^/]+\/board-round$/.test(normalized)) return "shark";
    if (normalized.endsWith("/ligas/membros")) return "members";
    if (normalized.endsWith("/ligas/eventos")) return "events";
    if (normalized.endsWith("/ligas/board-round")) return "shark";
    return "visual";
};

const extractErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message || "Erro inesperado.";
    if (typeof error === "string" && error.trim()) return error.trim();
    if (error && typeof error === "object") {
        const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
        const message = [raw.message, raw.details, raw.hint]
            .map((entry) => (typeof entry === "string" ? entry : ""))
            .filter((entry) => entry.length > 0)
            .join(" | ");
        if (message) return message;
        try {
            const serialized = JSON.stringify(error);
            if (serialized && serialized !== "{}") return serialized;
        } catch {
            // ignora serializacao
        }
    }
    return "Erro inesperado.";
};

export function LigasAdminPageContent() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ leagueId?: string }>();
  const pathname = usePathname();
  const { tenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const routeLeagueId =
    typeof params?.leagueId === "string" ? params.leagueId.trim() : "";
  const tenantScopeId =
    tenantId || (typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "");
  const lastSelectedStorageKey = buildLigaEditorLastSelectedKey(tenantScopeId);
  const routeTab = resolveLeagueTabFromPathname(pathname);
  
  // --- ESTADOS DE CONTROLE ---
  const [loading, setLoading] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<LigaAdminTab>(routeTab);
  const [saveActionLabel, setSaveActionLabel] = useState("");
  
  // Login
  const [ligasDisponiveis, setLigasDisponiveis] = useState<{id: string, nome: string}[]>([]);
  const [selectedLigaId, setSelectedLigaId] = useState("");
  const [senhaInput, setSenhaInput] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(true);

  // Dados da Liga Logada
  const [ligaData, setLigaData] = useState<LigaData | null>(null);
  const [sendNotification, setSendNotification] = useState(false);

  // --- MODAL DE BUSCA DE USUÁRIOS ---
  const [searchUserModal, setSearchUserModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [allUsers, setAllUsers] = useState<UserSearch[]>([]); 
  const [savedMemberIds, setSavedMemberIds] = useState<string[]>([]);

  // --- MODAL DE EVENTOS (CRIAR/EDITAR) ---
  const [eventModal, setEventModal] = useState(false);
  const [editingEventIdx, setEditingEventIdx] = useState<number | null>(null);
  const [currentEvent, setCurrentEvent] = useState<Partial<LeagueEvent>>({});
  const eventFileRef = useRef<HTMLInputElement>(null);
  const isLoggingOutRef = useRef(false);
  const [uploadingLeagueAsset, setUploadingLeagueAsset] = useState(false);
  const [uploadingEventImg, setUploadingEventImg] = useState(false);
  const [novoLote, setNovoLote] = useState<NovoLoteDraft>({ nome: "", preco: "", status: "ativo" });

  // --- 🦈 MODAL DE GESTÃO DE ENQUETES (NOVO) ---
  const [pollModal, setPollModal] = useState<string | null>(null); 
  const [polls, setPolls] = useState<Poll[]>([]);
  const [novaEnquete, setNovaEnquete] = useState({ question: "", allowUserOptions: true });
  const [pollDraftOptions, setPollDraftOptions] = useState<string[]>(["", ""]);

  useEffect(() => {
      setActiveTab(routeTab);
  }, [routeTab]);

  useEffect(() => {
      const preferredLeagueId = routeLeagueId || readSessionStorageValue(lastSelectedStorageKey);
      if (preferredLeagueId) {
          setSelectedLigaId(preferredLeagueId);
      }
  }, [lastSelectedStorageKey, routeLeagueId]);

  useEffect(() => {
      if (isLoggingOutRef.current) return;
      if (isLoggedIn || ligaData) return;

      const preferredLeagueId = routeLeagueId || readSessionStorageValue(lastSelectedStorageKey);
      if (!preferredLeagueId) return;
      const restoredDraft = readLigaEditorDraft(preferredLeagueId, tenantScopeId);
      if (!restoredDraft || !restoredDraft.ligaSenha) return;

      setLigaData({
          ...(restoredDraft.ligaDraft as Omit<LigaData, "senha">),
          senha: restoredDraft.ligaSenha,
      } as LigaData);
      setSelectedLigaId(preferredLeagueId);
      setSenhaInput(restoredDraft.ligaSenha);
      setActiveTab(routeTab);
      setSavedMemberIds(
          Array.isArray(restoredDraft.savedMemberIds)
              ? restoredDraft.savedMemberIds
              : extractMemberIds((restoredDraft.ligaDraft as Partial<LigaData>).membros as Member[] | undefined)
      );
      setSendNotification(restoredDraft.sendNotification);
      setEventModal(restoredDraft.eventModal);
      setEditingEventIdx(restoredDraft.editingEventIdx);
      setCurrentEvent(restoredDraft.currentEvent);
      setNovoLote(restoredDraft.novoLote);
      setIsLoggedIn(true);
      addToast("Sessao da liga restaurada.", "info");
      if (preferredLeagueId && preferredLeagueId !== routeLeagueId) {
          const nextPath = tenantSlug
              ? withTenantSlug(tenantSlug, buildLeagueSectionPath(routeTab, preferredLeagueId))
              : buildLeagueSectionPath(routeTab, preferredLeagueId);
          router.replace(nextPath);
      }
  }, [addToast, isLoggedIn, lastSelectedStorageKey, ligaData, routeLeagueId, routeTab, router, tenantScopeId, tenantSlug]);

  useEffect(() => {
      if (!selectedLigaId) return;
      writeSessionStorageValue(lastSelectedStorageKey, selectedLigaId);
  }, [lastSelectedStorageKey, selectedLigaId]);

  useEffect(() => {
      if (!isLoggedIn || !ligaData) return;

      const persist = () => {
          if (isLoggingOutRef.current) return;
          const { senha, ...ligaDraft } = ligaData;
          void senha;
          writeLigaEditorDraft(ligaData.id, {
              version: LIGA_EDITOR_DRAFT_VERSION,
              savedAt: Date.now(),
              ligaSenha: ligaData.senha,
              activeTab,
              savedMemberIds,
              sendNotification,
              ligaDraft,
              eventModal,
              editingEventIdx,
              currentEvent,
              novoLote,
          }, tenantScopeId);
      };

      const timer = window.setTimeout(persist, 120);
      return () => {
          window.clearTimeout(timer);
          if (isLoggingOutRef.current) return;
          persist();
      };
  }, [
      activeTab,
      currentEvent,
      editingEventIdx,
      eventModal,
      isLoggedIn,
      ligaData,
      novoLote,
      savedMemberIds,
      sendNotification,
      tenantScopeId,
  ]);

  // 1. CARREGAMENTO INICIAL
  useEffect(() => {
      let mounted = true;
      const fetchData = async () => {
          try {
              const leagues = await fetchLeagueSummaries({
                  orderByField: "nome",
                  orderDirection: "asc",
                  maxResults: 40,
                  tenantId: tenantScopeId || undefined,
              });
              if (!mounted) return;
              setLigasDisponiveis(leagues.map((league) => ({ id: league.id, nome: league.nome })));
          } catch (error: unknown) {
              console.error(error);
              if (mounted) addToast("Erro ao carregar ligas.", "error");
          } finally {
              if (mounted) setIsLoadingList(false);
          }
      };
      void fetchData();
      return () => {
          mounted = false;
      };
  }, [addToast, tenantScopeId]);

  // 2. BUSCA DE USUÁRIOS SOB DEMANDA
  useEffect(() => {
      if (!searchUserModal) return;
      let mounted = true;
      const loadUsers = async () => {
          try {
              const users = await fetchLeagueUsers({ maxResults: 120, tenantId: tenantScopeId || undefined });
              if (!mounted) return;
              setAllUsers(users as UserSearch[]);
          } catch (error: unknown) {
              console.error(error);
              if (mounted) addToast("Erro ao carregar usuários.", "error");
          }
      };
      void loadUsers();
      return () => {
          mounted = false;
      };
  }, [searchUserModal, addToast, tenantScopeId]);

  // 3. ENQUETES (SEM LISTENER)
  useEffect(() => {
      if (!pollModal) {
          setPolls([]);
          return;
      }
      let mounted = true;
      const loadPolls = async () => {
          try {
              const data = await fetchEventPolls(pollModal, { maxResults: 40, forceRefresh: false, tenantId: tenantScopeId || undefined });
              if (!mounted) return;
              setPolls(data as Poll[]);
          } catch (error: unknown) {
              console.error(error);
              if (mounted) addToast("Erro ao carregar enquetes.", "error");
          }
      };
      void loadPolls();
      return () => {
          mounted = false;
      };
  }, [pollModal, addToast, tenantScopeId]);

  useEffect(() => {
      if (pollModal) return;
      setNovaEnquete({ question: "", allowUserOptions: true });
      setPollDraftOptions(["", ""]);
  }, [pollModal]);

  // 4. FUNÇÃO DE LOGIN
  const handleLogin = async () => {
      if (!selectedLigaId || !senhaInput) return addToast("Preencha todos os campos!", "error");
      setLoading(true);
      try {
          const target = await fetchLeagueById(selectedLigaId, { forceRefresh: false, tenantId: tenantScopeId || undefined });
          
          if (target && target.senha === senhaInput) {
              const baseLigaData: LigaData = {
                  id: target.id,
                  nome: target.nome,
                  sigla: target.sigla || "",
                  descricao: target.descricao || "",
                  bizu: target.bizu || "",
                  likes: target.likes || 0,
                  senha: target.senha,
                  foto: target.foto || resolveLeagueLogoSrc(target) || "",
                  logoUrl: resolveLeagueLogoSrc(target) || undefined,
                  ativa: target.ativa,
                  perguntas: sanitizeQuestionDrafts((target.perguntas || []) as PerguntaLiga[]),
                  membros: (target.membros || []) as Member[],
                  eventos: (target.eventos || []) as LeagueEvent[],
                  membersCount: target.membersCount,
                  updatedAt: target.updatedAt,
              };
              const persistedMemberIds = extractMemberIds(baseLigaData.membros);
              const restoredDraft = readLigaEditorDraft(target.id, tenantScopeId);
              const persistedUpdatedAtMs = parseDateMs(baseLigaData.updatedAt);
              const shouldApplyDraft =
                  Boolean(restoredDraft) &&
                  (
                      persistedUpdatedAtMs <= 0 ||
                      (restoredDraft?.savedAt || 0) >= persistedUpdatedAtMs
                  );
              const mergedLigaData: LigaData = restoredDraft
                  ? shouldApplyDraft
                  ? {
                      ...baseLigaData,
                      ...restoredDraft.ligaDraft,
                      id: baseLigaData.id,
                      senha: baseLigaData.senha,
                      updatedAt: baseLigaData.updatedAt,
                  }
                  : baseLigaData
                  : baseLigaData;

              setLigaData(mergedLigaData);
              if (restoredDraft) {
                  setActiveTab(routeTab);
                  setSavedMemberIds(
                      Array.isArray(restoredDraft.savedMemberIds)
                          ? restoredDraft.savedMemberIds
                          : persistedMemberIds
                  );
                  setSendNotification(restoredDraft.sendNotification);
                  setEventModal(restoredDraft.eventModal);
                  setEditingEventIdx(restoredDraft.editingEventIdx);
                  setCurrentEvent(restoredDraft.currentEvent);
                  setNovoLote(restoredDraft.novoLote);
                  if (!shouldApplyDraft) {
                      addToast("Rascunho local mais antigo que a base salva. Exibindo a versao publicada.", "info");
                  }
              } else {
                  setActiveTab(routeTab);
                  setSavedMemberIds(persistedMemberIds);
                  setSendNotification(false);
                  setEventModal(false);
                  setEditingEventIdx(null);
                  setCurrentEvent({});
                  setNovoLote({ nome: "", preco: "", status: "ativo" });
              }
              setIsLoggedIn(true);
              addToast("Acesso autorizado!", "success");
              if (restoredDraft && shouldApplyDraft) {
                  addToast("Rascunho recuperado.", "info");
              }
              
              // LOG CORRIGIDO: ORDEM (ID, NOME, AÇÃO, RECURSO, DETALHES)
              router.replace(tenantPath(buildLeagueSectionPath(routeTab, target.id)));
              logActivity(
                  target.id, 
                  target.nome,
                  "LOGIN",
                  "ligas_config", 
                  "Acessou o painel de gestão"
              );

          } else { 
              addToast("Senha incorreta.", "error"); 
          }
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro de conexão.", "error"); 
      } finally { 
          setLoading(false); 
      }
  };

  const handleLeaguePanelLogout = () => {
      isLoggingOutRef.current = true;
      if (ligaData?.id) {
          clearLigaEditorDraft(ligaData.id, tenantScopeId);
      }
      removeSessionStorageValue(lastSelectedStorageKey);
      setEventModal(false);
      setEditingEventIdx(null);
      setCurrentEvent({});
      setNovoLote({ nome: "", preco: "", status: "ativo" });
      setSendNotification(false);
      setSenhaInput("");
      setSelectedLigaId("");
      setLigaData(null);
      setIsLoggedIn(false);
      addToast("Sessao da liga encerrada.", "info");
      window.setTimeout(() => {
          isLoggingOutRef.current = false;
      }, 0);
  };
  const classifyUploadError = (error: unknown): { message: string; type: "info" | "error" } => {
      const rawMessage = error instanceof Error ? error.message : String(error || "");
      const message = rawMessage.trim();
      const normalized = message.toLowerCase();

      if (!message) {
          return { message: "Deu ruim no plantao! Erro na imagem.", type: "error" };
      }
      if (
          normalized.includes("excede") &&
          (normalized.includes("mb") || normalized.includes("kb") || normalized.includes("byte"))
      ) {
          return { message: "Atualizacao informativa: " + message, type: "info" };
      }
      if (
          normalized.includes("resolucao maxima") ||
          normalized.includes("resolução máxima") ||
          normalized.includes("imagem muito grande")
      ) {
          return { message: "Atualizacao informativa: " + message, type: "info" };
      }

      return { message: "Deu ruim no plantao! " + message, type: "error" };
  };
  // --- UPLOADS ---
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'pergunta' | 'membro', index?: number) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      if (!file || !ligaData || uploadingLeagueAsset) {
          input.value = "";
          return;
      }

      setUploadingLeagueAsset(true);
      try {
          const imageUrl = await uploadLeagueImageToStorage({
              file,
              kind: type === 'logo' ? 'logo' : type === 'pergunta' ? 'question' : 'member',
              leagueId: ligaData.id,
              entityId: typeof index === 'number' ? String(index) : undefined,
          });

          if (type === 'logo') {
              setLigaData({ ...ligaData, foto: imageUrl, logoUrl: imageUrl });
          } else if (type === 'pergunta' && index !== undefined) {
              const novas = [...ligaData.perguntas];
              novas[index].imageUrl = imageUrl;
              setLigaData({ ...ligaData, perguntas: novas });
          } else if (type === 'membro' && index !== undefined && ligaData.membros) {
              const novos = [...ligaData.membros];
              novos[index].foto = imageUrl;
              setLigaData({ ...ligaData, membros: novos });
          }

          addToast("Imagem enviada com sucesso.", "success");
          await logActivity(
              ligaData.id,
              ligaData.nome,
              "UPDATE",
              "ligas_uploads",
              { tipo: type, index: index ?? null }
          );
      } catch (error: unknown) {
          console.error(error);
          const uploadToast = classifyUploadError(error);
          addToast(uploadToast.message, uploadToast.type);
      } finally {
          setUploadingLeagueAsset(false);
          input.value = "";
      }
  };

  const handleEventImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      if (!file || !ligaData || uploadingEventImg) {
          input.value = "";
          return;
      }

      setUploadingEventImg(true);
      try {
          const imageUrl = await uploadLeagueImageToStorage({
              file,
              kind: 'event',
              leagueId: ligaData.id,
              entityId: currentEvent.id || undefined,
          });
          setCurrentEvent(prev => ({ ...prev, imagem: imageUrl }));
          addToast("Capa do evento enviada com sucesso.", "success");
          await logActivity(
              ligaData.id,
              ligaData.nome,
              "UPDATE",
              "ligas_eventos_uploads",
              { eventId: currentEvent.id || null }
          );
      } catch (error: unknown) {
          console.error(error);
          const uploadToast = classifyUploadError(error);
          addToast(uploadToast.message, uploadToast.type);
      } finally {
          setUploadingEventImg(false);
          input.value = "";
      }
  };
  // --- MEMBROS ---
  const filteredUsers = searchTerm.length > 0 
      ? allUsers.filter(u => (u.nome || "").toLowerCase().includes(searchTerm.toLowerCase())) 
      : [];

  const addMemberFromSearch = (u: UserSearch) => {
      if (!ligaData) return;
      const newMember: Member = { 
          id: u.id, 
          nome: u.nome || "Sem Nome", 
          cargo: DEFAULT_LEAGUE_ROLE, 
          foto: u.foto || "", 
          linkPerfil: `/perfil/${u.id}` 
      };
      setLigaData({ ...ligaData, membros: [...(ligaData.membros || []), newMember] });
      setSearchUserModal(false);
      setSearchTerm("");
      addToast("Usuário adicionado! Defina o cargo.", "success");
  };

  const removeMember = (idx: number) => {
      if(!ligaData?.membros) return;
      setLigaData({ ...ligaData, membros: ligaData.membros.filter((_, i) => i !== idx) });
  };

  const updateMemberCargo = (idx: number, newCargo: string) => {
      if(!ligaData?.membros) return;
      const novos = [...ligaData.membros];
      novos[idx].cargo = resolveLeagueRoleLabel(newCargo);
      setLigaData({ ...ligaData, membros: novos });
  };

  // --- GESTÃO DE EVENTOS ---
  const handleOpenEventModal = (idx: number | null) => {
      if (idx !== null && ligaData?.eventos) {
          setCurrentEvent(ligaData.eventos[idx]);
          setEditingEventIdx(idx);
      } else {
          setCurrentEvent({ 
              id: Date.now().toString(), titulo: "", data: "", hora: "", local: "", 
              tipo: "Festa", destaque: "", imagem: "", imagePositionY: 50, 
              lotes: [], descricao: "", pollQuestion: "" 
          });
          setEditingEventIdx(null);
      }
      setEventModal(true);
  };

  const saveEventLocal = () => {
      if (!ligaData || !currentEvent.titulo) return addToast("Título obrigatório!", "error");
      const novosEventos = [...(ligaData.eventos || [])];
      const eventoSalvo = currentEvent as LeagueEvent;
      
      if (editingEventIdx !== null) {
          novosEventos[editingEventIdx] = eventoSalvo;
      } else {
          novosEventos.push(eventoSalvo);
      }
      setLigaData({ ...ligaData, eventos: novosEventos });
      setEventModal(false);
      return addToast("Evento salvo no rascunho local. Use PUBLICAR EVENTOS para atualizar o app.", "info");
  };

  // --- GESTÃO DE ENQUETES (SHARK FEATURE 🦈) ---
  
  // --- SALVAMENTO POR SEÇÃO ---
  const persistLeagueConfigPatch = async (patch: Record<string, unknown>) => {
      if (!ligaData) return;
      const supabase = getSupabaseClient();
      const { error } = await supabase
          .from("ligas_config")
          .update({
              ...patch,
              updatedAt: nowIso(),
          })
          .eq("id", ligaData.id);
      if (error) {
          throw new Error(extractErrorMessage(error));
      }
  };

  const runSectionSave = async (
      nextLabel: string,
      action: () => Promise<void>
  ) => {
      if (!ligaData || loading) return;

      setLoading(true);
      setSaveActionLabel(nextLabel);
      try {
          await action();
      } catch (error: unknown) {
          console.error("Falha ao salvar seção da liga:", error);
          addToast(`Erro ao salvar: ${extractErrorMessage(error)}`, "error");
      } finally {
          setLoading(false);
          setSaveActionLabel("");
      }
  };

  const handleSaveVisualSection = async () => {
      if (!ligaData) return;

      await runSectionSave("SALVANDO INFORMACOES...", async () => {
          const supabase = getSupabaseClient();
          const timestamp = nowIso();
          const leagueLogoUrl = resolveLeagueLogoSrc(ligaData) || "";

          await persistLeagueConfigPatch({
              nome: ligaData.nome,
              sigla: ligaData.sigla,
              descricao: ligaData.descricao || "",
              bizu: ligaData.bizu || "",
              likes: Number.isFinite(Number(ligaData.likes)) ? Number(ligaData.likes) : 0,
              senha: ligaData.senha,
              foto: leagueLogoUrl || null,
              logoUrl: leagueLogoUrl || null,
              logo: leagueLogoUrl || null,
              ativa: Boolean(ligaData.ativa),
          });

          if (sendNotification && ligaData.bizu) {
              const { error: notificationInsertError } = await supabase
                  .from("notifications")
                  .insert({
                      title: `Novo destaque da ${ligaData.sigla}!`,
                      message: ligaData.bizu,
                      link: "/ligas_usc",
                      read: false,
                      createdAt: timestamp,
                      userId: "GLOBAL",
                  });
              if (notificationInsertError) {
                  throw new Error(extractErrorMessage(notificationInsertError));
              }
              setSendNotification(false);
          }

          addToast("Informações salvas.", "success");
          await logActivity(
              ligaData.id,
              ligaData.nome,
              "UPDATE",
              "ligas_config",
              "Atualização das informações da liga"
          );
      });
  };

  const handleSaveMembersSection = async () => {
      if (!ligaData) return;

      await runSectionSave("SALVANDO MEMBROS...", async () => {
          const actorTenantId =
              tenantScopeId || (typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "");
          const members = sortLeagueMembersByRole(
              (ligaData.membros || []).map((member) => ({
                  ...member,
                  cargo: resolveLeagueRoleLabel(member.cargo),
              }))
          );
          const memberIds = extractMemberIds(members);

          await persistLeagueConfigPatch({
              membros: members,
              membersCount: members.length,
          });

          await syncLeagueMembers({
              leagueId: ligaData.id,
              members,
              tenantId: actorTenantId || undefined,
          });

          setSavedMemberIds(memberIds);
          setLigaData((prev) =>
              prev ? { ...prev, membros: members, membersCount: members.length } : prev
          );
          addToast("Membros sincronizados.", "success");

          await logActivity(
              ligaData.id,
              ligaData.nome,
              "UPDATE",
              "ligas_membros",
              { totalMembros: members.length }
          );
      });
  };

  const handleSaveEventsSection = async () => {
      if (!ligaData) return;

      await runSectionSave("PUBLICANDO EVENTOS...", async () => {
          const actorTenantId =
              tenantScopeId || (typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "");
          const leagueLogoUrl = resolveLeagueLogoSrc(ligaData) || "";
          const syncedEvents = await syncLeagueEvents({
              leagueId: ligaData.id,
              events: ligaData.eventos || [],
              leagueLogoUrl,
              leagueSigla: ligaData.sigla,
              tenantId: actorTenantId || undefined,
          });

          await persistLeagueConfigPatch({
              eventos: syncedEvents,
          });

          clearEventsNativeCaches();
          ClientCache.invalidatePattern("events:feed:*");
          setLigaData((prev) => (prev ? { ...prev, eventos: syncedEvents } : prev));
          addToast("Eventos publicados.", "success");

          await logActivity(
              ligaData.id,
              ligaData.nome,
              "UPDATE",
              "eventos",
              { totalEventos: syncedEvents.length }
          );
      });
  };

  const handleSaveBoardRoundSection = async () => {
      if (!ligaData) return;
      if (ligaData.perguntas.length < 10) {
          addToast("Minimo 10 perguntas necessarias.", "error");
          return;
      }

      await runSectionSave("SALVANDO BOARD ROUND...", async () => {
          const sanitizedQuestions = sanitizeQuestionDrafts(ligaData.perguntas);

          await persistLeagueConfigPatch({
              perguntas: sanitizedQuestions,
          });

          setLigaData((prev) => (prev ? { ...prev, perguntas: sanitizedQuestions } : prev));
          addToast("Board Round salvo.", "success");

          await logActivity(
              ligaData.id,
              ligaData.nome,
              "UPDATE",
              "ligas_board_round",
              { totalPerguntas: sanitizedQuestions.length }
          );
      });
  };

  const handleSaveCurrentSection = async () => {
      if (activeTab === "members") {
          await handleSaveMembersSection();
          return;
      }
      if (activeTab === "events") {
          await handleSaveEventsSection();
          return;
      }
      if (activeTab === "shark") {
          await handleSaveBoardRoundSection();
          return;
      }
      await handleSaveVisualSection();
  };

  // --- CRUD PERGUNTAS (BOARDROUND) ---
  const addQuestion = () => setLigaData(prev => prev ? ({...prev, perguntas: [...prev.perguntas, { id: Date.now().toString(), texto: "", alternativas: ["","","",""], correta: 0 }]}) : null);
  const removeQuestion = (idx: number) => setLigaData(prev => prev ? ({...prev, perguntas: prev.perguntas.filter((_, i) => i !== idx)}) : null);
  
  // CORREÇÃO: Tipagem do valor
  const updateQuestion = (idx: number, field: string, val: string | number) => {
      if(!ligaData) return;
      const novas = [...ligaData.perguntas];
      if(field === 'texto') novas[idx].texto = val as string; 
      else if(field === 'correta') novas[idx].correta = val as number; 
      else {
          const altIdx = parseInt(field.split('-')[1]); 
          novas[idx].alternativas[altIdx] = val as string;
      }
      setLigaData({ ...ligaData, perguntas: novas });
  };

  // --- RENDERIZAÇÃO ---
  const tenantPath = (path: string) =>
      tenantSlug ? withTenantSlug(tenantSlug, path) : path;
  const navigateToSection = (tab: LigaAdminTab) => {
      setActiveTab(tab);
      const scopedLeagueId = routeLeagueId || ligaData?.id || selectedLigaId;
      router.push(tenantPath(buildLeagueSectionPath(tab, scopedLeagueId)));
  };
  const openEventPresenceList = (eventId: string) => {
      const cleanEventId = eventId.trim();
      if (!cleanEventId) return;
      const scopedLeagueId = routeLeagueId || ligaData?.id || selectedLigaId;
      const path = scopedLeagueId
          ? `/ligas/${encodeURIComponent(scopedLeagueId)}/eventos/lista/${encodeURIComponent(cleanEventId)}`
          : `/ligas/eventos/lista/${encodeURIComponent(cleanEventId)}`;
      router.push(tenantPath(path));
  };
  const savedMemberIdSet = new Set(savedMemberIds);
  const allLeagueMembers = ligaData?.membros || [];
  const newlyAddedMembers = allLeagueMembers.filter(
      (member) => !savedMemberIdSet.has((member.id || "").trim())
  );
  const persistedMembers = allLeagueMembers.filter((member) =>
      savedMemberIdSet.has((member.id || "").trim())
  );
  const currentSaveButtonLabel =
      activeTab === "members"
          ? "SALVAR MEMBROS"
          : activeTab === "events"
          ? "PUBLICAR EVENTOS"
          : activeTab === "shark"
          ? "SALVAR BOARD ROUND"
          : "SALVAR INFORMACOES";

  if (!isLoggedIn) return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 font-sans text-white">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl space-y-4">
              <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-emerald-600 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                      <Lock className="text-white" size={32}/>
                  </div>
                  <h1 className="text-2xl font-black italic uppercase tracking-tighter">Portal das Ligas</h1>
                  <p className="text-sm text-zinc-500">Acesso Restrito à Diretoria</p>
              </div>
              <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Selecione sua Liga</label>
                  <select className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors" value={selectedLigaId} onChange={(e) => setSelectedLigaId(e.target.value)} disabled={isLoadingList}>
                      <option value="">{isLoadingList ? "Carregando Ligas..." : "Selecione..."}</option>
                      {ligasDisponiveis.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                  </select>
              </div>
              <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Senha de Acesso</label>
                  <input type="password" value={senhaInput} onChange={e => setSenhaInput(e.target.value)} className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors" placeholder="••••••"/>
              </div>
              <button onClick={handleLogin} disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg hover:shadow-emerald-900/20 flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="animate-spin"/> : <>Acessar Painel <ArrowRight size={18}/></>}
              </button>
          </div>
      </div>
  );

  return (
      <div className="min-h-screen bg-[#050505] text-white p-6 font-sans pb-32">
          
          <header className="flex flex-col gap-6 mb-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-xl font-black uppercase flex items-center gap-2">
                        <Layout className="text-blue-500"/> {ligaData?.nome}
                    </h1>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-1">Painel de Gestão</p>
                </div>
                <button onClick={handleLeaguePanelLogout} className="p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition">
                    <LogOut size={18}/>
                </button>
            </div>

            <div className="grid grid-cols-1 gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-2 md:grid-cols-4">
                <button onClick={() => navigateToSection('visual')} className={`rounded-xl px-4 py-3 text-left text-xs font-bold uppercase transition ${activeTab === 'visual' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:bg-zinc-800/50'}`}>
                    <span className="block text-[10px] text-zinc-500">1.</span>
                    Informações
                </button>
                <button onClick={() => navigateToSection('members')} className={`rounded-xl px-4 py-3 text-left text-xs font-bold uppercase transition ${activeTab === 'members' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:bg-zinc-800/50'}`}>
                    <span className="block text-[10px] text-zinc-500">2.</span>
                    Membros
                </button>
                <button onClick={() => navigateToSection('events')} className={`rounded-xl px-4 py-3 text-left text-xs font-bold uppercase transition ${activeTab === 'events' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:bg-zinc-800/50'}`}>
                    <span className="block text-[10px] text-zinc-500">3.</span>
                    Eventos
                </button>
                <button onClick={() => navigateToSection('shark')} className={`rounded-xl px-4 py-3 text-left text-xs font-bold uppercase transition ${activeTab === 'shark' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:bg-zinc-800/50'}`}>
                    <span className="block text-[10px] text-zinc-500">4.</span>
                    Board Round
                </button>
            </div>
          </header>

          {/* 1. VISUAL */}
          {activeTab === 'visual' && ligaData && (
              <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-[10px] font-bold text-zinc-500 uppercase">Sigla</label><input type="text" className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm outline-none focus:border-emerald-500 font-bold uppercase" value={ligaData.sigla} onChange={e => setLigaData({...ligaData, sigla: e.target.value})} maxLength={6}/></div>
                      <div>
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Nome Completo</label>
                        <input
                          type="text"
                          className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm outline-none focus:border-emerald-500"
                          value={ligaData.nome}
                          onChange={e => setLigaData({...ligaData, nome: e.target.value})}
                          maxLength={LEAGUE_NAME_MAX_LENGTH}
                        />
                        <p className="mt-1 text-[10px] text-zinc-500">
                          Maximo de {LEAGUE_NAME_MAX_LENGTH} caracteres para o nome caber melhor nos cards.
                        </p>
                      </div>
                  </div>
                  <div>
                      <label className="text-[10px] font-bold text-zinc-500 uppercase">Logo da Liga</label>
                      <div className="flex items-center gap-4 mt-2">
                          <label className="w-20 h-20 bg-black rounded-xl border-2 border-dashed border-zinc-700 flex items-center justify-center cursor-pointer hover:border-emerald-500 overflow-hidden relative group transition-colors">
                              {resolveLeagueLogoSrc(ligaData) ? (
                                <Image
                                  src={resolveLeagueLogoSrc(ligaData)}
                                  alt="Logo"
                                  fill
                                  sizes="80px"
                                  className="object-cover"
                                  
                                />
                              ) : (
                                <Upload size={20} className="text-zinc-500"/>
                              )}
                              <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp" disabled={uploadingLeagueAsset} onChange={(e) => handleImageUpload(e, 'logo')}/>
                          </label>
                          <span className="text-xs text-zinc-500 max-w-[150px]">Clique para alterar a logo.<br/>Recomendado: Quadrado.</span>
                      </div>
                  </div>
                  <div><label className="text-[10px] font-bold text-zinc-500 uppercase">Descrição</label><textarea className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm h-24 focus:border-emerald-500 outline-none resize-none" value={ligaData.descricao} onChange={e => setLigaData({...ligaData, descricao: e.target.value})}/></div>
                  <div className="bg-yellow-900/10 border border-yellow-500/20 p-4 rounded-xl">
                      <div className="flex justify-between items-center mb-2">
                          <label className="text-[10px] font-bold text-yellow-500 uppercase">Destaque da Semana</label>
                          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setSendNotification(!sendNotification)}>
                              <span className="text-[9px] text-zinc-400 uppercase font-bold">Enviar Notificação?</span>
                              <div className={`w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${sendNotification ? 'bg-emerald-500 justify-end' : 'bg-zinc-700 justify-start'}`}><div className="w-3 h-3 bg-white rounded-full shadow-sm"></div></div>
                          </div>
                      </div>
                      <input type="text" className="w-full bg-black border border-yellow-900/50 rounded-lg p-3 text-sm outline-none focus:border-yellow-500" value={ligaData.bizu} onChange={e => setLigaData({...ligaData, bizu: e.target.value})} placeholder="Ex: Encontro aberto para novos membros..."/>
                      {sendNotification && <p className="text-[9px] text-emerald-500 mt-2 flex items-center gap-1 animate-pulse"><Bell size={10}/> Uma notificação será enviada para todos ao salvar!</p>}
                  </div>
                  {/* Status no Jogo */}
                  <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex justify-between items-center">
                      <div>
                          <p className="text-xs text-zinc-500 uppercase font-bold">Status no BoardRound</p>
                          <p className={`text-sm font-black ${ligaData.ativa ? 'text-emerald-500' : 'text-zinc-600'}`}>{ligaData.ativa ? 'ATIVADA NO TABULEIRO' : 'AGUARDANDO ATIVAÇÃO'}</p>
                      </div>
                      <LayoutGrid className={ligaData.ativa ? "text-emerald-500" : "text-zinc-700"} size={24}/>
                  </div>
              </div>
          )}

          {/* 2. MEMBROS */}
          {activeTab === 'members' && ligaData && (
              <div className="space-y-6">
                  <div className="flex justify-between items-center bg-zinc-900 p-4 rounded-xl border border-zinc-800">
                      <div><h3 className="text-sm font-bold uppercase text-white">Diretoria</h3><p className="text-[10px] text-zinc-500">Adicione os membros oficiais.</p></div>
                      <button onClick={() => setSearchUserModal(true)} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition"><UserPlus size={14}/> Adicionar Aluno</button>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-4">
                          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4">
                              <h4 className="text-xs font-black uppercase text-emerald-400">Novos adicionados agora</h4>
                              <p className="mt-1 text-[10px] uppercase text-zinc-500">Entram na sincronização quando você clicar em salvar membros.</p>
                          </div>
                          <div className="grid grid-cols-1 gap-4">
                              {newlyAddedMembers.map((m) => {
                                  const idx = allLeagueMembers.findIndex((item) => item.id === m.id);
                                  return (
                                      <div key={`new-${m.id}-${idx}`} className="bg-zinc-900 p-4 rounded-xl border border-emerald-500/20 flex items-center gap-4 relative group hover:border-emerald-500/40 transition">
                                          <button onClick={() => removeMember(idx)} className="absolute top-2 right-2 text-zinc-600 hover:text-red-500"><Trash2 size={14}/></button>
                                          <div className="w-12 h-12 rounded-full bg-black border border-zinc-700 overflow-hidden shrink-0 relative">
                                            <Image
                                              src={m.foto || "https://github.com/shadcn.png"}
                                              alt={m.nome}
                                              fill
                                              sizes="48px"
                                              className="object-cover"
                                            />
                                          </div>
                                          <div className="flex-1 space-y-1">
                                              <p className="text-sm font-bold text-white">{m.nome}</p>
                                              <select
                                                value={resolveLeagueRoleLabel(m.cargo)}
                                                onChange={e => updateMemberCargo(idx, e.target.value)}
                                                className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs font-bold uppercase text-emerald-400 outline-none focus:border-emerald-500"
                                              >
                                                {LEAGUE_ROLE_OPTIONS.map((role) => (
                                                  <option key={role} value={role} className="bg-zinc-950 text-white">
                                                    {role}
                                                  </option>
                                                ))}
                                              </select>
                                          </div>
                                      </div>
                                  );
                              })}
                              {newlyAddedMembers.length === 0 && (
                                  <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 p-6 text-center text-xs text-zinc-500">
                                      Nenhum novo membro no rascunho.
                                  </div>
                              )}
                          </div>
                      </div>
                      <div className="space-y-4">
                          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                              <h4 className="text-xs font-black uppercase text-white">Membros já salvos</h4>
                              <p className="mt-1 text-[10px] uppercase text-zinc-500">Base atual da liga antes das novas alterações.</p>
                          </div>
                          <div className="grid grid-cols-1 gap-4">
                              {persistedMembers.map((m) => {
                                  const idx = allLeagueMembers.findIndex((item) => item.id === m.id);
                                  return (
                                      <div key={`saved-${m.id}-${idx}`} className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 flex items-center gap-4 relative group hover:border-zinc-600 transition">
                                          <button onClick={() => removeMember(idx)} className="absolute top-2 right-2 text-zinc-600 hover:text-red-500"><Trash2 size={14}/></button>
                                          <div className="w-12 h-12 rounded-full bg-black border border-zinc-700 overflow-hidden shrink-0 relative">
                                            <Image
                                              src={m.foto || "https://github.com/shadcn.png"}
                                              alt={m.nome}
                                              fill
                                              sizes="48px"
                                              className="object-cover"
                                            />
                                          </div>
                                          <div className="flex-1 space-y-1">
                                              <p className="text-sm font-bold text-white">{m.nome}</p>
                                              <select
                                                value={resolveLeagueRoleLabel(m.cargo)}
                                                onChange={e => updateMemberCargo(idx, e.target.value)}
                                                className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs font-bold uppercase text-emerald-400 outline-none focus:border-emerald-500"
                                              >
                                                {LEAGUE_ROLE_OPTIONS.map((role) => (
                                                  <option key={role} value={role} className="bg-zinc-950 text-white">
                                                    {role}
                                                  </option>
                                                ))}
                                              </select>
                                          </div>
                                      </div>
                                  );
                              })}
                              {persistedMembers.length === 0 && (
                                  <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 p-6 text-center text-xs text-zinc-500">
                                      Ainda não há membros persistidos nessa liga.
                                  </div>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          )}

          {/* 3. EVENTOS (TURBINADO 🦈) */}
          {activeTab === 'events' && ligaData && (
              <div className="space-y-6">
                  <div className="flex justify-between items-center bg-zinc-900 p-4 rounded-xl border border-zinc-800">
                      <div><h3 className="text-sm font-bold uppercase text-white">Eventos da Liga</h3><p className="text-[10px] text-zinc-500">Salve no modal e depois publique para sincronizar com a pagina de eventos do app.</p></div>
                      <button onClick={() => handleOpenEventModal(null)} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition"><Calendar size={14}/> Criar Evento</button>
                  </div>
                  <div className="space-y-3">
                      {ligaData.eventos?.map((ev, idx) => {
                          const eventImage = ev.imagem || resolveLeagueLogoSrc(ligaData);
                          return (
                              <div key={idx} className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 relative flex flex-col md:flex-row gap-4 items-start md:items-center">
                                  <button onClick={() => {const n=[...ligaData.eventos!]; n.splice(idx,1); setLigaData({...ligaData, eventos:n})}} className="absolute top-2 right-2 text-zinc-600 hover:text-red-500"><Trash2 size={14}/></button>
                                  {eventImage ? (
                                      <Image
                                        src={eventImage}
                                        alt={ev.titulo}
                                        width={64}
                                        height={64}
                                        className="w-16 h-16 rounded-lg object-cover bg-black"
                                        
                                      />
                                  ) : (
                                      <div className="w-16 h-16 rounded-lg bg-black" />
                                  )}
                                  <div className="flex-1">
                                      <h4 className="font-bold text-white text-sm mb-1">{ev.titulo}</h4>
                                      <div className="flex gap-3 text-[10px] text-zinc-400 font-bold uppercase">
                                          <span>{ev.data} - {ev.hora}</span>
                                          <span>•</span>
                                          <span>{ev.local}</span>
                                      </div>
                                      <div className="flex gap-2 mt-2">
                                          <button onClick={() => handleOpenEventModal(idx)} className="text-[10px] text-emerald-500 hover:underline flex items-center gap-1"><Edit3 size={10}/> Editar Evento</button>
                                          {ev.globalEventId && (
                                              <button onClick={() => openEventPresenceList(ev.globalEventId || "")} className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1"><Users size={10}/> Lista Presenca</button>
                                          )}
                                          {ev.globalEventId && (
                                              <button onClick={() => setPollModal(ev.globalEventId || null)} className="text-[10px] text-purple-400 hover:underline flex items-center gap-1"><MessageCircle size={10}/> Gerenciar Enquetes</button>
                                          )}
                                      </div>
                                  </div>
                              </div>
                          );
                      })}
                      {(!ligaData.eventos || ligaData.eventos.length === 0) && <div className="text-center py-8 text-zinc-600 text-xs">Nenhum evento criado.</div>}
                  </div>
              </div>
          )}

          {/* 4. BOARDROUND */}
          {activeTab === 'shark' && ligaData && (
              <div className="space-y-6">
                  <div className="flex justify-between items-center bg-zinc-900 p-4 rounded-xl border border-zinc-800">
                      <div><h3 className="text-sm font-bold uppercase text-white flex items-center gap-2">Banco de Questões <span className={`text-[10px] px-2 py-0.5 rounded border ${ligaData.perguntas.length >= 10 ? 'border-emerald-500 text-emerald-500' : 'border-red-500 text-red-500'}`}>{ligaData.perguntas.length}/10 Mínimo</span></h3></div>
                      <button onClick={addQuestion} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2"><Plus size={14}/> Nova Pergunta</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {ligaData.perguntas.map((p, idx) => (
                          <div key={idx} className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 relative group">
                              <button onClick={() => removeQuestion(idx)} className="absolute top-4 right-4 text-zinc-600 hover:text-red-500 transition"><Trash2 size={16}/></button>
                              <div className="mb-4 pr-8"><label className="text-[9px] font-bold text-zinc-500 uppercase">Enunciado (Max 140)</label><input type="text" maxLength={140} value={p.texto} onChange={e => updateQuestion(idx, 'texto', e.target.value)} className="w-full bg-transparent border-b border-zinc-700 focus:border-emerald-500 outline-none py-1 text-sm font-medium" placeholder="Digite a pergunta..."/></div>
                              <div className="space-y-2">{p.alternativas.map((alt, aIdx) => (<div key={aIdx} className="flex items-center gap-2"><input type="radio" name={`q-${idx}`} checked={p.correta === aIdx} onChange={() => updateQuestion(idx, 'correta', aIdx)} className="accent-emerald-500"/><input type="text" maxLength={50} value={alt} onChange={e => updateQuestion(idx, `alt-${aIdx}`, e.target.value)} className={`flex-1 bg-black rounded p-2 text-xs border ${p.correta === aIdx ? 'border-emerald-500 text-emerald-400' : 'border-zinc-800 text-zinc-400'}`} placeholder={`Opção ${aIdx+1}`}/></div>))}</div>
                          </div>
                      ))}
                  </div>
              </div>
          )}

          {/* --- BOTÃO SALVAR DA SEÇÃO ATIVA --- */}
          {ligaData && (
              <div className="fixed bottom-6 left-0 right-0 px-4 flex justify-center z-50 pointer-events-none">
                  <button onClick={handleSaveCurrentSection} disabled={loading} className="bg-emerald-500 hover:bg-emerald-400 text-black font-black py-4 px-10 rounded-full shadow-2xl flex items-center gap-2 transition transform hover:scale-105 active:scale-95 pointer-events-auto border-4 border-black">
                      {loading ? <><Loader2 className="animate-spin"/> {saveActionLabel || "SALVANDO..."}</> : <><Save size={20}/> {currentSaveButtonLabel}</>}
                  </button>
              </div>
          )}

          {/* --- MODAIS DE SUPORTE --- */}

          {/* MODAL SEARCH USER (Busca Local) */}
          {searchUserModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
                  <div className="bg-zinc-900 w-full max-w-md rounded-2xl border border-zinc-800 p-6 shadow-2xl relative animate-in zoom-in-95">
                      <button onClick={() => setSearchUserModal(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><X size={20}/></button>
                      <h3 className="text-sm font-bold text-white uppercase mb-4 flex items-center gap-2"><Search size={16} className="text-emerald-500"/> Buscar Aluno</h3>
                      <input type="text" placeholder="Digite o nome..." className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm text-white mb-4 outline-none focus:border-emerald-500" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                      <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                          {filteredUsers.map(u => (
                              <div key={u.id} className="flex items-center justify-between p-3 bg-black/50 rounded-lg cursor-pointer hover:bg-zinc-800 transition" onClick={() => addMemberFromSearch(u)}>
                                  <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 rounded-full bg-zinc-800 overflow-hidden relative">
                                        <Image
                                          src={u.foto || "https://github.com/shadcn.png"}
                                          alt={u.nome}
                                          fill
                                          sizes="32px"
                                          className="object-cover"
                                        />
                                      </div>
                                      <div><p className="text-xs font-bold text-white">{u.nome}</p><p className="text-[10px] text-zinc-500">{u.turma || "Sem turma"}</p></div>
                                  </div>
                                  <Plus size={14} className="text-emerald-500"/>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          )}

          {/* 🦈 MODAL GESTÃO ENQUETES (NOVO PARA LIGAS) */}
          {pollModal && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-md p-4" onClick={() => setPollModal(null)}>
                  <div className="bg-zinc-900 w-full max-w-lg rounded-2xl border border-zinc-800 flex flex-col animate-in zoom-in-95 duration-200 h-[80vh]" onClick={e => e.stopPropagation()}>
                      <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-black/40">
                          <div><h2 className="font-black text-white text-lg uppercase tracking-tighter flex items-center gap-2"><MessageCircle size={20} className="text-purple-500"/> Gestão de Enquetes</h2></div>
                          <button onClick={() => setPollModal(null)} className="p-2 hover:bg-zinc-800 rounded-full transition"><X size={20}/></button>
                      </div>
                      
                      <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                          <div className="bg-black/30 p-4 rounded-xl border border-zinc-800">
                              <label className="text-xs font-bold text-zinc-500 uppercase mb-2 block">Nova Enquete</label>
                              <input type="text" maxLength={EVENT_POLL_QUESTION_MAX_CHARS} placeholder="Pergunta..." className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm text-white mb-3" value={novaEnquete.question} onChange={e => setNovaEnquete({...novaEnquete, question: e.target.value.slice(0, EVENT_POLL_QUESTION_MAX_CHARS)})} />
                              <div className="flex items-center gap-2 mb-4">
                                  <input type="checkbox" id="allowOpts" checked={novaEnquete.allowUserOptions} onChange={e => setNovaEnquete({...novaEnquete, allowUserOptions: e.target.checked})} className="accent-purple-500"/>
                                  <label htmlFor="allowOpts" className="text-xs text-zinc-400">Permitir que usuários adicionem opções</label>
                              </div>
                              <div className="space-y-2 mb-4">
                                  {pollDraftOptions.map((option, index) => (
                                      <div key={`league-poll-option-${index}`} className="flex gap-2">
                                          <input
                                              type="text"
                                              maxLength={EVENT_POLL_OPTION_MAX_CHARS}
                                              placeholder={`Resposta ${index + 1}`}
                                              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm text-white"
                                              value={option}
                                              onChange={e => setPollDraftOptions((prev) => prev.map((entry, entryIndex) => entryIndex === index ? e.target.value.slice(0, EVENT_POLL_OPTION_MAX_CHARS) : entry))}
                                          />
                                          {pollDraftOptions.length > 2 ? (
                                              <button
                                                  type="button"
                                                  onClick={() => setPollDraftOptions((prev) => prev.filter((_, entryIndex) => entryIndex !== index))}
                                                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-zinc-400 hover:bg-zinc-800"
                                              >
                                                  <X size={14}/>
                                              </button>
                                          ) : null}
                                      </div>
                                  ))}
                              </div>
                              <div className="flex items-center justify-between gap-3 mb-4 text-[10px] font-bold uppercase text-zinc-500">
                                  <span>Opcoes iniciais opcionais</span>
                                  <button
                                      type="button"
                                      onClick={() => setPollDraftOptions((prev) => prev.length >= EVENT_POLL_OPTION_MAX_COUNT ? prev : [...prev, ""])}
                                      disabled={pollDraftOptions.length >= EVENT_POLL_OPTION_MAX_COUNT}
                                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                                  >
                                      Adicionar resposta
                                  </button>
                              </div>
                              <button onClick={async () => {
                                  if (!novaEnquete.question) return;
                                  try {
                                      const question = novaEnquete.question.trim().slice(0, EVENT_POLL_QUESTION_MAX_CHARS);
                                      const normalizedOptions = pollDraftOptions
                                          .map((option) => option.trim().slice(0, EVENT_POLL_OPTION_MAX_CHARS))
                                          .filter((option, index, array) => option.length > 0 && array.indexOf(option) === index)
                                          .slice(0, EVENT_POLL_OPTION_MAX_COUNT);
                                      const ref = await createEventPoll({
                                          eventId: pollModal,
                                          question,
                                          allowUserOptions: novaEnquete.allowUserOptions,
                                          options: normalizedOptions.map((text) => ({ text, votes: 0 })),
                                          creatorId: ligaData?.id,
                                          tenantId: tenantScopeId || undefined,
                                      });
                                      setPolls((prev) => [
                                          ...prev,
                                          {
                                              id: ref.id,
                                              question,
                                              allowUserOptions: novaEnquete.allowUserOptions,
                                              options: normalizedOptions.map((text) => ({ text, votes: 0 })),
                                              voters: [],
                                          },
                                      ]);
                                      setNovaEnquete({ question: "", allowUserOptions: true });
                                      setPollDraftOptions(["", ""]);
                                      addToast("Enquete criada!", "success");
                                      await logActivity(
                                          ligaData?.id || 'sys', 
                                          ligaData?.nome || 'Sistema', 
                                          "CREATE", 
                                          "events_polls", 
                                          { pollId: ref.id, eventId: pollModal, question }
                                      );
                                  } catch (error: unknown) {
                                      addToast(`Erro ao criar enquete: ${extractErrorMessage(error)}`, "error");
                                  }
                              }} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-lg text-xs uppercase">Criar Enquete</button>
                          </div>

                          <div className="space-y-4">
                              {polls.map(poll => (
                                  <div key={poll.id} className="bg-zinc-800/20 p-4 rounded-xl border border-zinc-800 space-y-3">
                                      <div className="flex justify-between items-start">
                                          <div>
                                              <p className="font-bold text-sm text-white">{poll.question}</p>
                                              <p className="text-[10px] text-zinc-500">{poll.options.length} opções • {poll.allowUserOptions ? "Aberta" : "Fechada"}</p>
                                          </div>
                                          <button onClick={async () => {
                                              if(confirm("Excluir enquete?")) {
                                                  try {
                                                      await deleteEventPoll({ eventId: pollModal, pollId: poll.id, tenantId: tenantScopeId || undefined });
                                                      setPolls((prev) => prev.filter((item) => item.id !== poll.id));
                                                      await logActivity(
                                                          ligaData?.id || 'sys', 
                                                          ligaData?.nome || 'Sistema', 
                                                          "DELETE", 
                                                          "events_polls", 
                                                          { pollId: poll.id, eventId: pollModal }
                                                      );
                                                  } catch (error: unknown) {
                                                      addToast(`Erro ao excluir enquete: ${extractErrorMessage(error)}`, "error");
                                                  }
                                              }
                                          }} className="text-zinc-600 hover:text-red-500 transition"><Trash2 size={16}/></button>
                                      </div>
                                      <div className="space-y-1 bg-black/20 p-2 rounded-lg max-h-40 overflow-y-auto custom-scrollbar">
                                          {poll.options.map((opt, idx) => (
                                              <div key={idx} className="flex justify-between items-center text-xs text-zinc-300 p-2 hover:bg-zinc-700/30 rounded group">
                                                  <div className="flex items-center gap-2">
                                                      {opt.creatorAvatar ? (
                                                        <Image
                                                          src={opt.creatorAvatar}
                                                          alt="Creator"
                                                          width={20}
                                                          height={20}
                                                          className="rounded-full object-cover border border-zinc-600"
                                                        />
                                                      ) : (
                                                        <div className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-[8px] font-bold">ADM</div>
                                                      )}
                                                      <span>{opt.text} <span className="text-zinc-500">({opt.votes})</span></span>
                                                  </div>
                                                  <button onClick={async () => {
                                                      if(!confirm("Remover opção?")) return;
                                                      try {
                                                          const newOptions = poll.options.filter((_, i) => i !== idx);
                                                          await updateEventPollOptions({
                                                              eventId: pollModal,
                                                              pollId: poll.id,
                                                              options: newOptions as PollOption[],
                                                              tenantId: tenantScopeId || undefined,
                                                          });
                                                          setPolls((prev) =>
                                                              prev.map((item) =>
                                                                  item.id === poll.id
                                                                      ? { ...item, options: newOptions }
                                                                      : item
                                                              )
                                                          );
                                                      } catch (error: unknown) {
                                                          addToast(`Erro ao atualizar enquete: ${extractErrorMessage(error)}`, "error");
                                                      }
                                                  }} className="text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><Trash2 size={12}/></button>
                                              </div>
                                          ))}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>
          )}

          {/* 🦈 MODAL EDITAR EVENTO (COM TURBO FEATURES 🦈) */}
          {eventModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 overflow-y-auto">
                  <div className="bg-zinc-950 w-full max-w-lg rounded-2xl border border-zinc-800 p-6 space-y-4 my-auto animate-in zoom-in-95">
                      <div className="flex justify-between items-center"><h2 className="font-bold text-white text-lg">Evento da Liga</h2><button onClick={() => setEventModal(false)}><X size={20} className="text-zinc-500"/></button></div>
                      
                      <div onClick={() => eventFileRef.current?.click()} className="h-32 border-2 border-dashed border-zinc-700 rounded-xl flex items-center justify-center cursor-pointer bg-black/20 relative group overflow-hidden">
                          <input type="file" ref={eventFileRef} className="hidden" accept="image/png,image/jpeg,image/webp" disabled={uploadingEventImg} onChange={handleEventImageUpload}/>
                          {uploadingEventImg ? (
                              <span className="text-xs text-emerald-500 animate-pulse">Enviando...</span>
                          ) : currentEvent.imagem ? (
                              <Image
                                src={currentEvent.imagem}
                                alt="Evento"
                                fill
                                sizes="(max-width: 768px) 90vw, 512px"
                                className="object-cover"
                                style={{ objectPosition: `50% ${currentEvent.imagePositionY || 50}%` }}
                                
                              />
                          ) : (
                              <div className="text-center text-zinc-500"><ImageIcon/><span className="text-xs">Capa</span></div>
                          )}
                      </div>
                      {currentEvent.imagem && <div className="bg-zinc-900 p-2 rounded-xl"><div className="flex justify-between text-[10px] text-zinc-400 uppercase mb-1"><span>Ajuste Vertical</span><span>{currentEvent.imagePositionY || 50}%</span></div><input type="range" min="0" max="100" value={currentEvent.imagePositionY || 50} onChange={(e) => setCurrentEvent({ ...currentEvent, imagePositionY: Number(e.target.value) })} className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"/></div>}
                      
                      <input type="text" placeholder="Título do Evento" className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none" value={currentEvent.titulo || ""} onChange={(e) => setCurrentEvent({ ...currentEvent, titulo: e.target.value })} />
                      <div className="grid grid-cols-2 gap-3">
                          <input type="date" className="bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white" value={currentEvent.data || ""} onChange={(e) => setCurrentEvent({ ...currentEvent, data: e.target.value })} />
                          <input type="time" className="bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white" value={currentEvent.hora || ""} onChange={(e) => setCurrentEvent({ ...currentEvent, hora: e.target.value })} />
                      </div>
                      <input type="text" placeholder="Local" className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white" value={currentEvent.local || ""} onChange={(e) => setCurrentEvent({ ...currentEvent, local: e.target.value })} />
                      
                      <div>
                          <label className="text-[10px] text-zinc-500 font-bold uppercase mb-1 block">Descrição do Evento</label>
                          <textarea className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white h-24 resize-none focus:border-emerald-500 outline-none" placeholder="Detalhes, regras, atrações..." value={currentEvent.descricao || ""} onChange={(e) => setCurrentEvent({ ...currentEvent, descricao: e.target.value })} />
                      </div>

                      <div className="bg-purple-900/10 border border-purple-500/20 p-4 rounded-xl">
                          <label className="text-[10px] text-purple-400 font-bold uppercase mb-2 flex items-center gap-2"><MessageCircle size={12}/> Pergunta da Enquete (Opcional)</label>
                          <input 
                              type="text" 
                              className="w-full bg-black border border-purple-900/50 rounded-lg p-3 text-sm outline-none focus:border-purple-500" 
                              value={currentEvent.pollQuestion || ""} 
                              onChange={e => setCurrentEvent({...currentEvent, pollQuestion: e.target.value})} 
                              placeholder="Ex: Qual tema vocês preferem?"
                          />
                      </div>

                      <div className="bg-black/40 border border-zinc-800 rounded-xl p-4">
                          <label className="text-xs text-zinc-500 font-bold uppercase mb-2 block">Lotes de Ingressos</label>
                          <div className="grid grid-cols-3 gap-2 mb-2">
                              <input type="text" placeholder="Nome" className="col-span-2 bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-xs text-white" value={novoLote.nome} onChange={e => setNovoLote({...novoLote, nome: e.target.value})} />
                              <input type="text" placeholder="R$" className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-xs text-white" value={novoLote.preco} onChange={e => setNovoLote({...novoLote, preco: e.target.value})} />
                          </div>
                          <button onClick={() => {if(novoLote.nome && novoLote.preco) { setCurrentEvent({...currentEvent, lotes: [...(currentEvent.lotes||[]), {id: Date.now(), ...novoLote}]}); setNovoLote({nome:"",preco:"",status:"ativo"}); }}} className="w-full bg-emerald-600 text-white py-2 rounded-lg font-bold text-xs uppercase hover:bg-emerald-500">Adicionar</button>
                          <div className="space-y-1 mt-2 max-h-24 overflow-y-auto custom-scrollbar">
                              {currentEvent.lotes?.map(l => (
                                  <div key={l.id} className="flex justify-between items-center text-xs bg-zinc-900 px-3 py-2 rounded border border-zinc-800">
                                      <span className="text-white font-bold">{l.nome} - {l.preco}</span>
                                      <div className="flex items-center gap-2">
                                          <span className="text-[9px] text-zinc-500 uppercase">{l.status}</span>
                                          <button onClick={() => setCurrentEvent({...currentEvent, lotes: currentEvent.lotes?.filter(lo => lo.id !== l.id)})} className="text-red-500"><X size={12}/></button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>

                      <div className="flex gap-3 pt-2">
                          <button onClick={() => setEventModal(false)} className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-400 font-bold text-xs uppercase hover:bg-zinc-800">Cancelar</button>
                          <button onClick={saveEventLocal} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase hover:bg-emerald-500">Salvar Evento</button>
                      </div>
                  </div>
              </div>
          )}
      </div>
  );
}

export default function LigasAdminPage() {
    return <LigasAdminPageContent />;
}



