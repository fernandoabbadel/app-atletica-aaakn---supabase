import { httpsCallable } from "@/lib/supa/functions";
import { getSupabaseClient } from "./supabase";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { incrementUserStats } from "./supabaseData";
import {
  buildTenantScopedRowId,
  parseTenantScopedRowId,
} from "./tenantScopedCatalog";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 35_000;

const MAX_PLAN_RESULTS = 60;
const MAX_SUBSCRIPTION_RESULTS = 900;
const MAX_REQUEST_RESULTS = 500;
const MAX_USER_REQUEST_RESULTS = 90;
const PLAN_VISUAL_SNAPSHOT_SYNC_LIMIT = 500;
const PLAN_COMMERCE_SYNC_LIMIT = 500;

const PLAN_CREATE_REQUEST_CALLABLE = "planCreateAdhesionRequest";
const PLAN_UPSERT_CALLABLE = "planAdminUpsert";
const PLAN_DELETE_CALLABLE = "planAdminDelete";
const PLAN_SEED_CALLABLE = "planAdminSeedDefaults";
const PLAN_APPROVE_CALLABLE = "planAdminApproveRequest";
const PLAN_REJECT_CALLABLE = "planAdminRejectRequest";
const PLAN_DELETE_REQUEST_CALLABLE = "planAdminDeleteRequest";
const PLAN_SAVE_BANNER_CALLABLE = "planAdminSaveBanner";
const PLANOS_SELECT_COLUMNS =
  "id,nome,preco,precoVal,parcelamento,descricao,cor,icon,destaque,beneficios,xpMultiplier,nivelPrioridade,descontoLoja,displayOrder";
const PLANOS_LEGACY_SELECT_COLUMNS =
  "id,nome,preco,precoVal,parcelamento,descricao,cor,icon,destaque,beneficios,xpMultiplier,nivelPrioridade,descontoLoja";
const ASSINATURAS_SELECT_COLUMNS =
  "id,aluno,turma,foto,planoId,planoNome,valorPago,dataInicio,status,metodo,userId";
const SOLICITACOES_ADESAO_SELECT_COLUMNS =
  "id,userId,userName,userTurma,planoId,planoNome,valor,comprovanteUrl,dataSolicitacao,status,metodo";
const APP_CONFIG_BANNER_SELECT_COLUMNS = "id,titulo,subtitulo,cor";
const APP_CONFIG_FINANCEIRO_SELECT_COLUMNS = "id,chave,banco,titular,whatsapp";

const plansCache = new Map<string, CacheEntry<PlanRecord[]>>();
const planByIdCache = new Map<string, CacheEntry<PlanRecord | null>>();
const subscriptionsCache = new Map<string, CacheEntry<PlanSubscriptionRecord[]>>();
const adminRequestsCache = new Map<string, CacheEntry<PlanRequestRecord[]>>();
const userRequestsCache = new Map<string, CacheEntry<PlanRequestRecord[]>>();
const bannerCache = new Map<string, CacheEntry<BannerConfigRecord>>();
const financeConfigCache = new Map<string, CacheEntry<FinanceConfigRecord>>();

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

const nowIso = (): string => new Date().toISOString();

const throwSupabaseError = (error: {
  message: string;
  code?: string | null;
  name?: string | null;
}): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getMapCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setMapCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const resolveConfigTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const resolvePlanTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const buildPlanIdCandidates = (
  planId: string,
  tenantId?: string | null
): string[] => {
  const cleanPlanId = planId.trim();
  if (!cleanPlanId) return [];

  const scopedTenantId = resolvePlanTenantId(tenantId);
  const scopedId = buildTenantScopedRowId(scopedTenantId, cleanPlanId);
  const baseId = parseTenantScopedRowId(cleanPlanId).baseId;

  return Array.from(
    new Set([scopedId, cleanPlanId, baseId].map((entry) => entry.trim()).filter(Boolean))
  );
};

const slugifyPlanBaseId = (value: string): string => {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || `plano_${Date.now()}`;
};

const resolveConfigDocIds = (
  baseId: string,
  tenantId?: string | null
): string[] => {
  const scopedTenantId = resolveConfigTenantId(tenantId);
  if (!scopedTenantId) return [baseId];
  return [buildTenantScopedRowId(scopedTenantId, baseId)];
};

const pickConfigRow = (
  rows: Array<Record<string, unknown>>,
  baseId: string,
  tenantId?: string | null
): Record<string, unknown> | null => {
  const candidates = resolveConfigDocIds(baseId, tenantId);
  for (const candidateId of candidates) {
    const match = rows.find((row) => asString(row.id).trim() === candidateId);
    if (match) return match;
  }
  return null;
};

const shouldFallbackToClientWrites = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (!code) return true;

  return (
    code.includes("functions/not-found") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/internal") ||
    code.includes("functions/deadline-exceeded") ||
    code.includes("functions/cancelled") ||
    code.includes("functions/unknown")
  );
};

const isIndexRequiredError = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }

  return false;
};

const getBackendErrorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  const data = asObject(error);
  const message = typeof data?.message === "string" ? data.message : "";
  const details = typeof data?.details === "string" ? data.details : "";
  return `${message} ${details}`.trim();
};

const extractMissingColumnFromSchemaError = (error: unknown): string | null => {
  const message = getBackendErrorText(error);
  if (!message) return null;

  const normalized = message.toLowerCase();
  const isMissingColumnError =
    normalized.includes("schema cache") ||
    (normalized.includes("column") && normalized.includes("does not exist")) ||
    (normalized.includes("could not find the") && normalized.includes("column"));

  if (!isMissingColumnError) return null;

  const patterns = [
    /could not find the ['"]?([a-z0-9_]+)['"]? column/i,
    /column ['"]?([a-z0-9_]+)['"]? does not exist/i,
    /column\s+([a-z0-9_]+)\s+does not exist/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
};

const findPatchKeyByColumn = (
  patch: Record<string, unknown>,
  columnName: string
): string | null => {
  const target = columnName.trim().toLowerCase();
  if (!target) return null;

  const key = Object.keys(patch).find((entry) => entry.toLowerCase() === target);
  return key ?? null;
};

const updateUserWithSchemaFallback = async (
  userId: string,
  patch: Record<string, unknown>
): Promise<void> => {
  const supabase = getSupabaseClient();
  const mutablePatch: Record<string, unknown> = { ...patch };

  while (Object.keys(mutablePatch).length > 0) {
    try {
      const { error } = await supabase
        .from("users")
        .update(mutablePatch)
        .eq("uid", userId);
      if (error) throw error;
      return;
    } catch (error: unknown) {
      const missingColumn = extractMissingColumnFromSchemaError(error);
      const removableKey = missingColumn
        ? findPatchKeyByColumn(mutablePatch, missingColumn)
        : null;

      if (!removableKey) throw error;
      delete mutablePatch[removableKey];
      console.warn(
        `Plan approval fallback: coluna ausente "${missingColumn}" em users; seguindo sem esse campo.`
      );
    }
  }
};

const updatePlanWithSchemaFallback = async (options: {
  planId: string;
  tenantId?: string | null;
  patch: Record<string, unknown>;
}): Promise<void> => {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolvePlanTenantId(options.tenantId);
  const mutablePatch: Record<string, unknown> = { ...options.patch };

  while (Object.keys(mutablePatch).length > 0) {
    try {
      let query = supabase
        .from("planos")
        .update(mutablePatch)
        .eq("id", options.planId.trim());
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throw error;
      return;
    } catch (error: unknown) {
      const missingColumn = extractMissingColumnFromSchemaError(error);
      const removableKey = missingColumn
        ? findPatchKeyByColumn(mutablePatch, missingColumn)
        : null;
      if (!removableKey) throw error;

      delete mutablePatch[removableKey];
      console.warn(
        `Plan update fallback: coluna ausente "${missingColumn}" em planos; seguindo sem esse campo.`
      );
    }
  }
};

const upsertPlanRowsWithSchemaFallback = async (
  rows: Array<Record<string, unknown>>
): Promise<void> => {
  const supabase = getSupabaseClient();
  let mutableRows = rows.map((row) => ({ ...row }));

  while (mutableRows.length > 0) {
    try {
      const { error } = await supabase.from("planos").upsert(mutableRows, {
        onConflict: "id",
      });
      if (error) throw error;
      return;
    } catch (error: unknown) {
      const missingColumn = extractMissingColumnFromSchemaError(error);
      if (!missingColumn) throw error;

      let removed = false;
      mutableRows = mutableRows.map((row) => {
        const removableKey = findPatchKeyByColumn(row, missingColumn);
        if (!removableKey) return row;
        removed = true;
        const nextRow = { ...row };
        delete nextRow[removableKey];
        return nextRow;
      });

      if (!removed) throw error;

      console.warn(
        `Plan upsert fallback: coluna ausente "${missingColumn}" em planos; seguindo sem esse campo.`
      );
    }
  }
};

async function callWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>
): Promise<TRes> {
  try {
    const callable = httpsCallable<TReq, TRes>(functions, callableName);
    const response = await callable(payload);
    return response.data;
  } catch (error: unknown) {
    if (shouldFallbackToClientWrites(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

const toMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  const obj = asObject(value);
  const toDate = obj?.toDate;
  if (typeof toDate === "function") {
    const result = toDate.call(value) as Date;
    if (result instanceof Date) return result.getTime();
  }
  return 0;
};

const sortByDateDesc = <T>(rows: T[], getDateValue: (entry: T) => unknown): T[] =>
  [...rows].sort((left, right) => toMillis(getDateValue(right)) - toMillis(getDateValue(left)));

async function syncPlanVisualSnapshotsForUser(payload: {
  userId: string;
  plano: string;
  planoCor: string;
  planoIcon: string;
}): Promise<void> {
  const userId = payload.userId.trim();
  if (!userId) return;

  const syncCollection = async (
    collectionName: "posts" | "posts_comments" | "eventos_comentarios",
    patch: Record<string, unknown>
  ) => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(collectionName)
      .select("id")
      .eq("userId", userId)
      .limit(PLAN_VISUAL_SNAPSHOT_SYNC_LIMIT);
    if (error) throw error;

    const rows = (data ?? []) as Array<{ id?: unknown }>;
    const ids = rows
      .map((row) => asString(row.id).trim())
      .filter((value): value is string => value.length > 0);
    if (ids.length === 0) return;

    await Promise.all(
      ids.map(async (id) => {
        const { error: updateError } = await supabase
          .from(collectionName)
          .update(patch)
          .eq("id", id);
        if (updateError) throw updateError;
      })
    );

    if (ids.length >= PLAN_VISUAL_SNAPSHOT_SYNC_LIMIT) {
      console.warn(
        `Plan snapshot sync atingiu limite de ${PLAN_VISUAL_SNAPSHOT_SYNC_LIMIT} em ${collectionName} para user ${userId}.`
      );
    }
  };

  const tasks = [
    syncCollection("posts", {
      plano: payload.plano,
      plano_cor: payload.planoCor,
      plano_icon: payload.planoIcon,
      updatedAt: nowIso(),
    }),
    syncCollection("posts_comments", {
      plano: payload.plano,
      plano_cor: payload.planoCor,
      plano_icon: payload.planoIcon,
      updatedAt: nowIso(),
    }),
    syncCollection("eventos_comentarios", {
      userPlanoCor: payload.planoCor,
      userPlanoIcon: payload.planoIcon,
      updatedAt: nowIso(),
    }),
  ];

  const results = await Promise.allSettled(tasks);
  if (results.some((result) => result.status === "rejected")) {
    console.warn("Falha parcial ao sincronizar snapshots de plano do usuario.", {
      userId,
      results,
    });
  }
}

export interface PlanRecord {
  id: string;
  nome: string;
  preco: string;
  precoVal: number;
  parcelamento: string;
  descricao: string;
  cor: string;
  icon: string;
  destaque: boolean;
  beneficios: string[];
  xpMultiplier: number;
  nivelPrioridade: number;
  descontoLoja: number;
  displayOrder: number;
}

export interface PlanRequestRecord {
  id: string;
  userId: string;
  userName: string;
  userTurma: string;
  planoId: string;
  planoNome: string;
  valor: number;
  comprovanteUrl: string;
  dataSolicitacao: unknown;
  status: "pendente" | "aprovado" | "rejeitado";
  metodo?: string;
}

export interface PlanSubscriptionRecord {
  id: string;
  aluno: string;
  turma: string;
  foto?: string;
  planoId: string;
  planoNome: string;
  valorPago: number;
  dataInicio: string;
  status: "ativo" | "vencido" | "pendente";
  metodo: "pix" | "cartao";
  userId?: string;
}

export interface BannerConfigRecord {
  titulo: string;
  subtitulo: string;
  cor: "dourado" | "esmeralda" | "roxo" | "fogo";
}

export interface FinanceConfigRecord {
  chave: string;
  banco: string;
  titular: string;
  whatsapp?: string;
}

type DefaultPlanSeedEntry = {
  id: string;
  data: Omit<PlanRecord, "id">;
};

const DEFAULT_BANNER_CONFIG: BannerConfigRecord = {
  titulo: "SEJA SOCIO DA ATLETICA",
  subtitulo: "Beneficios oficiais para o seu ecossistema",
  cor: "dourado",
};

const DEFAULT_FINANCE_CONFIG: FinanceConfigRecord = {
  chave: "financeiro@atletica.com.br",
  banco: "Banco da Atletica",
  titular: "Atletica",
};

const DEFAULT_PLAN_CATALOG: readonly DefaultPlanSeedEntry[] = [
  {
    id: "bicho_solto",
    data: {
      nome: "Bicho Solto",
      preco: "0,00",
      precoVal: 0,
      parcelamento: "Acesso gratuito",
      descricao: "Entrada no ecossistema da atletica",
      cor: "zinc",
      icon: "ghost",
      destaque: false,
      beneficios: [
        "Acesso ao app e carteira digital",
        "Participacao em eventos abertos",
        "Ranking e funcionalidades basicas",
      ],
      xpMultiplier: 1,
      nivelPrioridade: 1,
      descontoLoja: 0,
      displayOrder: 0,
    },
  },
  {
    id: "cardume_livre",
    data: {
      nome: "Cardume Livre",
      preco: "14,90",
      precoVal: 14.9,
      parcelamento: "ou 12x de R$ 1,49",
      descricao: "Primeiro nivel premium",
      cor: "blue",
      icon: "fish",
      destaque: false,
      beneficios: [
        "Desconto em parceiros selecionados",
        "Prioridade moderada em lotes",
        "Acesso a conteudos exclusivos",
      ],
      xpMultiplier: 1.1,
      nivelPrioridade: 2,
      descontoLoja: 5,
      displayOrder: 1,
    },
  },
  {
    id: "atleta",
    data: {
      nome: "Atleta",
      preco: "29,90",
      precoVal: 29.9,
      parcelamento: "ou 12x de R$ 2,99",
      descricao: "Plano oficial do atleta",
      cor: "emerald",
      icon: "star",
      destaque: true,
      beneficios: [
        "Prioridade em eventos e inscricoes",
        "Desconto ampliado na loja",
        "Multiplicador de XP turbinado",
      ],
      xpMultiplier: 1.25,
      nivelPrioridade: 3,
      descontoLoja: 10,
      displayOrder: 2,
    },
  },
  {
    id: "lenda",
    data: {
      nome: "Lenda",
      preco: "59,90",
      precoVal: 59.9,
      parcelamento: "ou 12x de R$ 5,99",
      descricao: "Maximo nivel de beneficios",
      cor: "yellow",
      icon: "crown",
      destaque: true,
      beneficios: [
        "Prioridade maxima no ecossistema",
        "Maior desconto na loja",
        "Beneficios VIP em acoes especiais",
      ],
      xpMultiplier: 1.5,
      nivelPrioridade: 4,
      descontoLoja: 20,
      displayOrder: 3,
    },
  },
] as const;

const normalizePlan = (id: string, raw: unknown): PlanRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    nome: asString(data.nome, "Plano"),
    preco: asString(data.preco, "0,00"),
    precoVal: Math.max(0, asNumber(data.precoVal, 0)),
    parcelamento: asString(data.parcelamento, ""),
    descricao: asString(data.descricao, ""),
    cor: asString(data.cor, "zinc"),
    icon: asString(data.icon, "star"),
    destaque: asBoolean(data.destaque, false),
    beneficios: asStringArray(data.beneficios).slice(0, 40),
    xpMultiplier: Math.max(0, asNumber(data.xpMultiplier, 1)),
    nivelPrioridade: Math.max(1, asNumber(data.nivelPrioridade, 1)),
    descontoLoja: Math.max(0, asNumber(data.descontoLoja, 0)),
    displayOrder: Math.max(0, Math.floor(asNumber(data.displayOrder, Number.MAX_SAFE_INTEGER))),
  };
};

const normalizeRequest = (id: string, raw: unknown): PlanRequestRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const statusRaw = asString(data.status, "pendente");
  const status: "pendente" | "aprovado" | "rejeitado" =
    statusRaw === "aprovado" || statusRaw === "rejeitado" ? statusRaw : "pendente";

  const metodo = asString(data.metodo) || undefined;

  return {
    id,
    userId: asString(data.userId),
    userName: asString(data.userName, "Aluno"),
    userTurma: asString(data.userTurma, "T??"),
    planoId: asString(data.planoId),
    planoNome: asString(data.planoNome),
    valor: Math.max(0, asNumber(data.valor, 0)),
    comprovanteUrl: asString(data.comprovanteUrl),
    dataSolicitacao: data.dataSolicitacao,
    status,
    ...(metodo ? { metodo } : {}),
  };
};

const normalizeSubscription = (
  id: string,
  raw: unknown
): PlanSubscriptionRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const statusRaw = asString(data.status, "ativo");
  const status: "ativo" | "vencido" | "pendente" =
    statusRaw === "vencido" || statusRaw === "pendente" ? statusRaw : "ativo";

  const metodoRaw = asString(data.metodo, "pix");
  const metodo: "pix" | "cartao" = metodoRaw === "cartao" ? "cartao" : "pix";

  const foto = asString(data.foto) || undefined;
  const userId = asString(data.userId) || undefined;

  return {
    id,
    aluno: asString(data.aluno, "Aluno"),
    turma: asString(data.turma, "T??"),
    ...(foto ? { foto } : {}),
    planoId: asString(data.planoId),
    planoNome: asString(data.planoNome),
    valorPago: Math.max(0, asNumber(data.valorPago, 0)),
    dataInicio: asString(data.dataInicio),
    status,
    metodo,
    ...(userId ? { userId } : {}),
  };
};

const normalizePlanPayload = (
  payload: Partial<PlanRecord>
): Omit<PlanRecord, "id"> => ({
  nome: asString(payload.nome, "Plano").trim().slice(0, 80),
  preco: asString(payload.preco, "0,00").trim().slice(0, 20),
  precoVal: Math.max(0, asNumber(payload.precoVal, 0)),
  parcelamento: asString(payload.parcelamento).trim().slice(0, 120),
  descricao: asString(payload.descricao).slice(0, 500),
  cor: asString(payload.cor, "zinc").trim().slice(0, 20),
  icon: asString(payload.icon, "star").trim().slice(0, 30),
  destaque: Boolean(payload.destaque),
  beneficios: asStringArray(payload.beneficios).map((entry) => entry.slice(0, 120)).slice(0, 40),
  xpMultiplier: Math.max(0, asNumber(payload.xpMultiplier, 1)),
  nivelPrioridade: Math.max(1, asNumber(payload.nivelPrioridade, 1)),
  descontoLoja: Math.max(0, asNumber(payload.descontoLoja, 0)),
  displayOrder: Math.max(
    0,
    Math.floor(asNumber(payload.displayOrder, Number.MAX_SAFE_INTEGER))
  ),
});

const normalizePlanReferenceValue = (value: unknown): string =>
  asString(value)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const buildPlanReferenceKeys = (planId: string, planName: string): Set<string> => {
  const keys = new Set<string>();
  const scopedPlanId = normalizePlanReferenceValue(planId);
  const basePlanId = normalizePlanReferenceValue(parseTenantScopedRowId(planId).baseId);
  const normalizedPlanName = normalizePlanReferenceValue(planName);

  if (scopedPlanId) keys.add(scopedPlanId);
  if (basePlanId) keys.add(basePlanId);
  if (normalizedPlanName) keys.add(normalizedPlanName);

  return keys;
};

const matchesPlanReference = (
  entry: Record<string, unknown>,
  referenceKeys: Set<string>
): boolean => {
  const candidates = [
    normalizePlanReferenceValue(entry.planId),
    normalizePlanReferenceValue(entry.id),
    normalizePlanReferenceValue(parseTenantScopedRowId(asString(entry.planId)).baseId),
    normalizePlanReferenceValue(parseTenantScopedRowId(asString(entry.id)).baseId),
    normalizePlanReferenceValue(entry.planName),
    normalizePlanReferenceValue(entry.nome),
  ].filter((value) => value.length > 0);

  return candidates.some((value) => referenceKeys.has(value));
};

const syncPlanScopedCommerceReferences = async (options: {
  planId: string;
  planName: string;
  tenantId?: string | null;
}): Promise<void> => {
  const planId = options.planId.trim();
  const planName = options.planName.trim();
  if (!planId || !planName) return;

  const referenceKeys = buildPlanReferenceKeys(planId, planName);
  const supabase = getSupabaseClient();
  const scopedTenantId = resolvePlanTenantId(options.tenantId);

  let productsQuery = supabase
    .from("produtos")
    .select("id,plan_visibility")
    .limit(PLAN_COMMERCE_SYNC_LIMIT);
  let eventsQuery = supabase
    .from("eventos")
    .select("id,lotes")
    .limit(PLAN_COMMERCE_SYNC_LIMIT);

  if (scopedTenantId) {
    productsQuery = productsQuery.eq("tenant_id", scopedTenantId);
    eventsQuery = eventsQuery.eq("tenant_id", scopedTenantId);
  }

  const [{ data: productRows, error: productsError }, { data: eventRows, error: eventsError }] =
    await Promise.all([productsQuery, eventsQuery]);

  if (productsError) throwSupabaseError(productsError);
  if (eventsError) throwSupabaseError(eventsError);

  const productPromises: Array<Promise<void>> = [];
  (productRows ?? []).forEach((row) => {
    const data = row as Record<string, unknown>;
    const rowId = asString(data.id).trim();
    const currentEntries = Array.isArray(data.plan_visibility)
      ? data.plan_visibility
      : [];
    if (!rowId || currentEntries.length === 0) return;

    let changed = false;
    const nextEntries = currentEntries
      .map((entry) => {
        const item = asObject(entry);
        if (!item) return null;

        if (!matchesPlanReference(item, referenceKeys)) {
          return {
            planId: asString(item.planId || item.id).trim(),
            planName: asString(item.planName || item.nome).trim(),
            visible: asBoolean(item.visible, true),
          };
        }

        changed = true;
        return {
          planId,
          planName,
          visible: asBoolean(item.visible, true),
        };
      })
      .filter(
        (
          entry
        ): entry is { planId: string; planName: string; visible: boolean } => entry !== null
      );

    if (!nextEntries.some((entry) => matchesPlanReference(entry, referenceKeys))) {
      nextEntries.push({ planId, planName, visible: true });
      changed = true;
    }

    if (!changed) return;

    productPromises.push(
      (async () => {
        let query = supabase
          .from("produtos")
          .update({ plan_visibility: nextEntries, updatedAt: nowIso() })
          .eq("id", rowId);
        if (scopedTenantId) {
          query = query.eq("tenant_id", scopedTenantId);
        }
        const { error } = await query;
        if (error) throwSupabaseError(error);
      })()
    );
  });

  const eventPromises: Array<Promise<void>> = [];
  (eventRows ?? []).forEach((row) => {
    const data = row as Record<string, unknown>;
    const rowId = asString(data.id).trim();
    const lotes = Array.isArray(data.lotes) ? data.lotes : [];
    if (!rowId || lotes.length === 0) return;

    let eventChanged = false;
    const nextLotes = lotes.map((entry) => {
      const lote = asObject(entry);
      if (!lote) return entry;

      const currentPlanPricesRaw = lote.planPrices ?? lote.plan_prices;
      const currentPlanPrices = Array.isArray(currentPlanPricesRaw)
        ? currentPlanPricesRaw
        : [];
      if (currentPlanPrices.length === 0) return lote;

      let loteChanged = false;
      const nextPlanPrices = currentPlanPrices
        .map((priceEntry: unknown) => {
          const item = asObject(priceEntry);
          if (!item) return null;

          if (!matchesPlanReference(item, referenceKeys)) {
            return {
              planId: asString(item.planId || item.id).trim(),
              planName: asString(item.planName || item.nome).trim(),
              price: asNumber(item.price ?? item.preco, 0),
            };
          }

          loteChanged = true;
          return {
            planId,
            planName,
            price: asNumber(item.price ?? item.preco, 0),
          };
        })
        .filter(
          (
            item
          ): item is { planId: string; planName: string; price: number } => item !== null
        );

      if (!loteChanged) return lote;

      eventChanged = true;
      return {
        ...lote,
        planPrices: nextPlanPrices,
      };
    });

    if (!eventChanged) return;

    eventPromises.push(
      (async () => {
        let query = supabase
          .from("eventos")
          .update({ lotes: nextLotes, updatedAt: nowIso() })
          .eq("id", rowId);
        if (scopedTenantId) {
          query = query.eq("tenant_id", scopedTenantId);
        }
        const { error } = await query;
        if (error) throwSupabaseError(error);
      })()
    );
  });

  await Promise.all([...productPromises, ...eventPromises]);
};

const normalizeBannerConfig = (raw: unknown): BannerConfigRecord => {
  const data = asObject(raw);
  if (!data) return DEFAULT_BANNER_CONFIG;

  const corRaw = asString(data.cor, "dourado");
  const cor: BannerConfigRecord["cor"] =
    corRaw === "esmeralda" || corRaw === "roxo" || corRaw === "fogo"
      ? corRaw
      : "dourado";

  return {
    titulo: asString(data.titulo, DEFAULT_BANNER_CONFIG.titulo).slice(0, 80),
    subtitulo: asString(data.subtitulo, DEFAULT_BANNER_CONFIG.subtitulo).slice(0, 160),
    cor,
  };
};

const normalizeFinanceConfig = (raw: unknown): FinanceConfigRecord => {
  const data = asObject(raw);
  if (!data) return DEFAULT_FINANCE_CONFIG;

  const whatsapp = asString(data.whatsapp).trim() || undefined;
  return {
    chave: asString(data.chave, DEFAULT_FINANCE_CONFIG.chave).trim().slice(0, 160),
    banco: asString(data.banco, DEFAULT_FINANCE_CONFIG.banco).trim().slice(0, 80),
    titular: asString(data.titular, DEFAULT_FINANCE_CONFIG.titular).trim().slice(0, 160),
    ...(whatsapp ? { whatsapp } : {}),
  };
};

const clearPlanReadCaches = (): void => {
  plansCache.clear();
  planByIdCache.clear();
};

const clearAdminPlanReadCaches = (): void => {
  subscriptionsCache.clear();
  adminRequestsCache.clear();
  userRequestsCache.clear();
};

export async function fetchPlanCatalog(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<PlanRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 24, MAX_PLAN_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePlanTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(plansCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const runQuery = async (withDisplayOrder: boolean): Promise<unknown[] | null> => {
    let query = supabase
      .from("planos")
      .select(withDisplayOrder ? PLANOS_SELECT_COLUMNS : PLANOS_LEGACY_SELECT_COLUMNS);
    query = withDisplayOrder
      ? query.order("displayOrder", { ascending: true }).order("precoVal", { ascending: true })
      : query.order("precoVal", { ascending: true });
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query.limit(maxResults);
    if (error) {
      const missingColumn = extractMissingColumnFromSchemaError(error);
      if (withDisplayOrder && missingColumn?.toLowerCase() === "displayorder") {
        return null;
      }
      throwSupabaseError(error);
    }
    return Array.isArray(data) ? (data as unknown[]) : [];
  };

  const data = (await runQuery(true)) ?? (await runQuery(false)) ?? [];
  const plans = data
    .map((row) => normalizePlan(asString((row as Record<string, unknown>).id), row))
    .filter((row): row is PlanRecord => row !== null)
    .sort((left, right) => {
      if (left.displayOrder !== right.displayOrder) {
        return left.displayOrder - right.displayOrder;
      }
      if (left.precoVal !== right.precoVal) {
        return left.precoVal - right.precoVal;
      }
      return left.nome.localeCompare(right.nome, "pt-BR");
    })
    .map((plan, index) => ({
      ...plan,
      displayOrder:
        Number.isFinite(plan.displayOrder) && plan.displayOrder !== Number.MAX_SAFE_INTEGER
          ? plan.displayOrder
          : index,
    }));

  setMapCachedValue(plansCache, cacheKey, plans);
  return plans;
}

export async function fetchPlanById(
  planId: string,
  options?: { forceRefresh?: boolean; tenantId?: string | null }
): Promise<PlanRecord | null> {
  const cleanId = planId.trim();
  if (!cleanId) return null;

  const scopedTenantId = resolvePlanTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${cleanId}`;
  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh) {
    const cachedEntry = planByIdCache.get(cacheKey);
    if (cachedEntry) {
      if (Date.now() - cachedEntry.cachedAt <= READ_CACHE_TTL_MS) {
        return cachedEntry.value;
      }
      planByIdCache.delete(cacheKey);
    }
  }

  const supabase = getSupabaseClient();
  const candidateIds = buildPlanIdCandidates(cleanId, scopedTenantId);
  if (candidateIds.length === 0) {
    setMapCachedValue(planByIdCache, cacheKey, null);
    return null;
  }

  const runQuery = async (withDisplayOrder: boolean): Promise<unknown[] | null> => {
    let query = supabase
      .from("planos")
      .select(withDisplayOrder ? PLANOS_SELECT_COLUMNS : PLANOS_LEGACY_SELECT_COLUMNS)
      .in("id", candidateIds);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query.limit(candidateIds.length);
    if (error) {
      const missingColumn = extractMissingColumnFromSchemaError(error);
      if (withDisplayOrder && missingColumn?.toLowerCase() === "displayorder") {
        return null;
      }
      throwSupabaseError(error);
    }
    return Array.isArray(data) ? (data as unknown[]) : [];
  };

  const data = (await runQuery(true)) ?? (await runQuery(false)) ?? [];

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    setMapCachedValue(planByIdCache, cacheKey, null);
    return null;
  }

  const selectedRow =
    candidateIds
      .map((candidateId) =>
        rows.find((row) => asString((row as Record<string, unknown>).id).trim() === candidateId)
      )
      .find((row) => row !== undefined) ?? rows[0];

  const plan = normalizePlan(asString((selectedRow as Record<string, unknown>).id), selectedRow);
  setMapCachedValue(planByIdCache, cacheKey, plan);
  return plan;
}

export async function movePlanToDisplayPosition(payload: {
  planId: string;
  targetPosition: number;
  tenantId?: string | null;
}): Promise<PlanRecord[]> {
  const cleanPlanId = payload.planId.trim();
  if (!cleanPlanId) return [];

  const scopedTenantId = resolvePlanTenantId(payload.tenantId);
  const plans = await fetchPlanCatalog({
    maxResults: MAX_PLAN_RESULTS,
    forceRefresh: true,
    tenantId: scopedTenantId,
  });
  if (plans.length === 0) return [];

  const currentIndex = plans.findIndex((plan) => plan.id === cleanPlanId);
  if (currentIndex < 0) return plans;

  const targetIndex = Math.max(
    0,
    Math.min(plans.length - 1, Math.floor(payload.targetPosition) - 1)
  );
  if (currentIndex === targetIndex) return plans;

  const orderedPlans = [...plans];
  const [movedPlan] = orderedPlans.splice(currentIndex, 1);
  orderedPlans.splice(targetIndex, 0, movedPlan);

  await upsertPlanRowsWithSchemaFallback(
    orderedPlans.map((plan, index) => ({
      id: plan.id,
      tenant_id: scopedTenantId || null,
      displayOrder: index,
      updatedAt: nowIso(),
    }))
  );

  clearPlanReadCaches();
  return orderedPlans.map((plan, index) => ({
    ...plan,
    displayOrder: index,
  }));
}

export async function fetchPlanSubscriptions(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<PlanSubscriptionRecord[]> {
  const maxResults = boundedLimit(
    options?.maxResults ?? 480,
    MAX_SUBSCRIPTION_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePlanTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(subscriptionsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("assinaturas")
    .select(ASSINATURAS_SELECT_COLUMNS)
    .order("dataInicio", { ascending: false });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.limit(maxResults);
  if (error) throwSupabaseError(error);

  const rows = (data ?? [])
    .map((row) =>
      normalizeSubscription(asString((row as Record<string, unknown>).id), row)
    )
    .filter((row): row is PlanSubscriptionRecord => row !== null);

  setMapCachedValue(subscriptionsCache, cacheKey, rows);
  return rows;
}

export async function fetchPlanRequests(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<PlanRequestRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 260, MAX_REQUEST_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePlanTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(adminRequestsCache, cacheKey);
    if (cached) return cached;
  }

  let rows: PlanRequestRecord[] = [];
  const supabase = getSupabaseClient();
  try {
    let query = supabase
      .from("solicitacoes_adesao")
      .select(SOLICITACOES_ADESAO_SELECT_COLUMNS)
      .order("dataSolicitacao", { ascending: false });
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query.limit(maxResults);
    if (error) throw error;

    rows = (data ?? [])
      .map((row) => normalizeRequest(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is PlanRequestRecord => row !== null);
  } catch (error: unknown) {
    if (!isIndexRequiredError(error)) {
      const e = error as { message?: string; code?: string | null; name?: string | null };
      if (typeof e?.message === "string") throwSupabaseError(e as { message: string; code?: string | null; name?: string | null });
      throw error;
    }

    let fallbackQuery = supabase
      .from("solicitacoes_adesao")
      .select(SOLICITACOES_ADESAO_SELECT_COLUMNS);
    if (scopedTenantId) {
      fallbackQuery = fallbackQuery.eq("tenant_id", scopedTenantId);
    }
    const { data: fallbackData, error: fallbackError } = await fallbackQuery.limit(maxResults);
    if (fallbackError) throwSupabaseError(fallbackError);

    rows = sortByDateDesc(
      (fallbackData ?? [])
        .map((row) => normalizeRequest(asString((row as Record<string, unknown>).id), row))
        .filter((row): row is PlanRequestRecord => row !== null),
      (entry) => entry.dataSolicitacao
    );
  }

  setMapCachedValue(adminRequestsCache, cacheKey, rows);
  return rows;
}

export async function fetchUserPlanRequests(
  userId: string,
  options?: { maxResults?: number; forceRefresh?: boolean; tenantId?: string | null }
): Promise<PlanRequestRecord[]> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return [];

  const maxResults = boundedLimit(
    options?.maxResults ?? 30,
    MAX_USER_REQUEST_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePlanTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${cleanUserId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(userRequestsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("solicitacoes_adesao")
    .select(SOLICITACOES_ADESAO_SELECT_COLUMNS)
    .eq("userId", cleanUserId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.limit(maxResults);
  if (error) throwSupabaseError(error);

  const rows = sortByDateDesc(
    (data ?? [])
      .map((row) => normalizeRequest(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is PlanRequestRecord => row !== null),
    (entry) => entry.dataSolicitacao
  );

  setMapCachedValue(userRequestsCache, cacheKey, rows);
  return rows;
}

export async function fetchMarketingBannerConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<BannerConfigRecord> {
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveConfigTenantId(options?.tenantId);
  const cacheKey = scopedTenantId || "global";

  if (!forceRefresh) {
    const cached = getMapCachedValue(bannerCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const docIds = resolveConfigDocIds("marketing_banner", scopedTenantId);
  const { data, error } = await supabase
    .from("app_config")
    .select(APP_CONFIG_BANNER_SELECT_COLUMNS)
    .in("id", docIds);
  if (error) throwSupabaseError(error);

  const selected = pickConfigRow(
    ((data as Array<Record<string, unknown>> | null) ?? []).map((entry) => ({ ...entry })),
    "marketing_banner",
    scopedTenantId
  );
  const normalized = selected ? normalizeBannerConfig(selected) : DEFAULT_BANNER_CONFIG;

  setMapCachedValue(bannerCache, cacheKey, normalized);
  return normalized;
}

export async function fetchFinanceConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<FinanceConfigRecord> {
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveConfigTenantId(options?.tenantId);
  const cacheKey = scopedTenantId || "global";

  if (!forceRefresh) {
    const cached = getMapCachedValue(financeConfigCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const docIds = resolveConfigDocIds("financeiro", scopedTenantId);
  const { data, error } = await supabase
    .from("app_config")
    .select(APP_CONFIG_FINANCEIRO_SELECT_COLUMNS)
    .in("id", docIds);
  if (error) throwSupabaseError(error);

  const selected = pickConfigRow(
    ((data as Array<Record<string, unknown>> | null) ?? []).map((entry) => ({ ...entry })),
    "financeiro",
    scopedTenantId
  );
  const normalized = selected ? normalizeFinanceConfig(selected) : DEFAULT_FINANCE_CONFIG;

  setMapCachedValue(financeConfigCache, cacheKey, normalized);
  return normalized;
}

export async function createPlanRequest(payload: {
  userId: string;
  userName: string;
  userTurma: string;
  planoId: string;
  planoNome: string;
  valor: number;
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const scopedTenantId = resolvePlanTenantId(payload.tenantId);
  const requestPayload = {
    userId: payload.userId.trim(),
    userName: payload.userName.trim().slice(0, 120) || "Aluno",
    userTurma: payload.userTurma.trim().slice(0, 20) || "T??",
    planoId: payload.planoId.trim(),
    planoNome: payload.planoNome.trim().slice(0, 120),
    valor: Math.max(0, payload.valor),
  };

  if (!requestPayload.userId || !requestPayload.planoId) {
    throw new Error("Dados invalidos para criar solicitacao.");
  }

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    PLAN_CREATE_REQUEST_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("solicitacoes_adesao")
        .insert({
          ...requestPayload,
          ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
          dataSolicitacao: nowIso(),
          status: "pendente",
          metodo: "whatsapp",
        })
        .select("id")
        .single();
      if (error) throwSupabaseError(error);

      return { id: asString((data as Record<string, unknown> | null)?.id) };
    }
  );

  clearAdminPlanReadCaches();
  return result;
}

export async function upsertPlan(payload: {
  id?: string;
  data: Partial<PlanRecord>;
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const id = payload.id?.trim() || "";
  const normalizedData = normalizePlanPayload(payload.data);
  const scopedTenantId = resolvePlanTenantId(payload.tenantId);
  const scopedId =
    buildTenantScopedRowId(
      scopedTenantId,
      id || slugifyPlanBaseId(normalizedData.nome)
    ) ||
    id ||
    slugifyPlanBaseId(normalizedData.nome);
  const requestPayload = { id: scopedId, data: normalizedData };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    PLAN_UPSERT_CALLABLE,
    requestPayload,
    async () => {
      if (id) {
        await updatePlanWithSchemaFallback({
          planId: scopedId,
          tenantId: scopedTenantId,
          patch: {
            ...normalizedData,
            tenant_id: scopedTenantId || null,
            updatedAt: nowIso(),
          },
        });
        return { id: scopedId };
      }

      await upsertPlanRowsWithSchemaFallback([
        {
          id: scopedId,
          ...normalizedData,
          tenant_id: scopedTenantId || null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
      ]);
      return { id: scopedId };
    }
  );

  try {
    await syncPlanScopedCommerceReferences({
      planId: result.id || scopedId,
      planName: normalizedData.nome,
      tenantId: scopedTenantId,
    });
  } catch (error: unknown) {
    console.warn("Falha ao sincronizar referencias comerciais do plano.", error);
  }

  clearPlanReadCaches();
  return result;
}

export async function deletePlan(
  planId: string,
  options?: { tenantId?: string | null }
): Promise<void> {
  const cleanId = planId.trim();
  if (!cleanId) return;
  const scopedTenantId = resolvePlanTenantId(options?.tenantId);
  const candidateIds = buildPlanIdCandidates(cleanId, scopedTenantId);

  await callWithFallback<{ id: string }, { ok: boolean }>(
    PLAN_DELETE_CALLABLE,
    { id: candidateIds[0] || cleanId },
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase.from("planos").delete().in("id", candidateIds);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  clearPlanReadCaches();
}

export async function seedDefaultPlans(
  entries: Partial<PlanRecord>[],
  options?: { tenantId?: string | null }
): Promise<void> {
  const safeEntries = entries
    .slice(0, MAX_PLAN_RESULTS)
    .map((entry) => normalizePlanPayload(entry));
  const scopedTenantId = resolvePlanTenantId(options?.tenantId);

  await callWithFallback<{ plans: Omit<PlanRecord, "id">[] }, { ok: boolean }>(
    PLAN_SEED_CALLABLE,
    { plans: safeEntries },
    async () => {
      if (safeEntries.length === 0) return { ok: true };
      const rows = safeEntries.map((entry) => ({
        id: buildTenantScopedRowId(scopedTenantId, slugifyPlanBaseId(entry.nome)),
        ...entry,
        tenant_id: scopedTenantId || null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }));
      await upsertPlanRowsWithSchemaFallback(rows);
      return { ok: true };
    }
  );

  clearPlanReadCaches();
}

export async function restoreDefaultPlanCatalog(options?: {
  overwriteExisting?: boolean;
  tenantId?: string | null;
}): Promise<{ restored: number; skipped: boolean }> {
  const overwriteExisting = options?.overwriteExisting ?? false;
  const scopedTenantId = resolvePlanTenantId(options?.tenantId);

  const existing = await fetchPlanCatalog({
    maxResults: MAX_PLAN_RESULTS,
    forceRefresh: true,
    tenantId: scopedTenantId,
  });
  const existingBaseIds = new Set(
    existing
      .map((plan) => parseTenantScopedRowId(plan.id).baseId.trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
  const entriesToRestore = overwriteExisting
    ? [...DEFAULT_PLAN_CATALOG]
    : DEFAULT_PLAN_CATALOG.filter(
        (entry) => !existingBaseIds.has(entry.id.trim().toLowerCase())
      );
  if (entriesToRestore.length === 0) {
    return { restored: 0, skipped: true };
  }

  const writes = entriesToRestore.map(async (entry) => {
    await upsertPlanRowsWithSchemaFallback([
      {
        id: buildTenantScopedRowId(scopedTenantId, entry.id) || entry.id,
        ...entry.data,
        tenant_id: scopedTenantId || null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    ]);
  });
  await Promise.all(writes);
  clearPlanReadCaches();
  return { restored: entriesToRestore.length, skipped: false };
}

export async function saveMarketingBannerConfig(
  config: BannerConfigRecord,
  options?: { tenantId?: string | null }
): Promise<void> {
  const normalized = normalizeBannerConfig(config);
  const scopedTenantId = resolveConfigTenantId(options?.tenantId);

  await callWithFallback<
    { config: BannerConfigRecord; tenantId?: string },
    { ok: boolean }
  >(
    PLAN_SAVE_BANNER_CALLABLE,
    { config: normalized, tenantId: scopedTenantId || undefined },
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("app_config").upsert(
        {
          id: buildTenantScopedRowId(scopedTenantId, "marketing_banner") || "marketing_banner",
          ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
          ...normalized,
        },
        { onConflict: "id" }
      );
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  setMapCachedValue(bannerCache, scopedTenantId || "global", normalized);
}

export async function approvePlanRequest(payload: {
  requestId: string;
  userId: string;
  userName: string;
  userTurma: string;
  planoId: string;
  planoNome: string;
  valor: number;
  userPatch: {
    plano: string;
    planoBadge: string;
    planoCor: string;
    planoIcon: string;
    tier: "lenda" | "atleta" | "cardume" | "bicho";
    xpMultiplier: number;
    nivelPrioridade: number;
    descontoLoja: number;
  };
}): Promise<{ subscriptionId: string }> {
  const approvedAt = new Date().toISOString();
  const requestPayload = {
    ...payload,
    requestId: payload.requestId.trim(),
    userId: payload.userId.trim(),
    userName: payload.userName.trim().slice(0, 120) || "Aluno",
    userTurma: payload.userTurma.trim().slice(0, 20) || "T??",
    planoId: payload.planoId.trim(),
    planoNome: payload.planoNome.trim().slice(0, 120),
    valor: Math.max(0, payload.valor),
    userPatch: {
      plano: payload.userPatch.plano.trim().slice(0, 120),
      planoBadge: payload.userPatch.planoBadge.trim().slice(0, 120),
      planoCor: payload.userPatch.planoCor.trim().slice(0, 30),
      planoIcon: payload.userPatch.planoIcon.trim().slice(0, 30),
      tier: payload.userPatch.tier,
      xpMultiplier: Math.max(0, payload.userPatch.xpMultiplier),
      nivelPrioridade: Math.max(1, payload.userPatch.nivelPrioridade),
      descontoLoja: Math.max(0, payload.userPatch.descontoLoja),
    },
  };
  const completeUserPatch = {
    plano: requestPayload.userPatch.plano,
    plano_status: "ativo",
    plano_badge: requestPayload.userPatch.planoBadge,
    plano_cor: requestPayload.userPatch.planoCor,
    plano_icon: requestPayload.userPatch.planoIcon,
    tier: requestPayload.userPatch.tier,
    xpMultiplier: requestPayload.userPatch.xpMultiplier,
    nivel_prioridade: requestPayload.userPatch.nivelPrioridade,
    desconto_loja: requestPayload.userPatch.descontoLoja,
    data_adesao: approvedAt,
  };

  if (!requestPayload.requestId || !requestPayload.userId) {
    throw new Error("Solicitacao invalida para aprovacao.");
  }

  const result = await callWithFallback<
    typeof requestPayload,
    { subscriptionId: string }
  >(PLAN_APPROVE_CALLABLE, requestPayload, async () => {
    const supabase = getSupabaseClient();
    const { error: requestUpdateError } = await supabase
      .from("solicitacoes_adesao")
      .update({ status: "aprovado" })
      .eq("id", requestPayload.requestId);
    if (requestUpdateError) throwSupabaseError(requestUpdateError);

    const { data: subscriptionData, error: subscriptionError } = await supabase
      .from("assinaturas")
      .insert({
        aluno: requestPayload.userName,
        turma: requestPayload.userTurma,
        planoId: requestPayload.planoId,
        planoNome: requestPayload.planoNome,
        valorPago: requestPayload.valor,
        dataInicio: new Date().toLocaleDateString("pt-BR"),
        status: "ativo",
        metodo: "pix",
        userId: requestPayload.userId,
        createdAt: nowIso(),
      })
      .select("id")
      .single();
    if (subscriptionError) throwSupabaseError(subscriptionError);

    return {
      subscriptionId: asString((subscriptionData as Record<string, unknown> | null)?.id),
    };
  });

  // Garante sincronizacao dos campos visuais/beneficios no users mesmo quando
  // a Function de aprovacao estiver desatualizada ou com schema legado.
  await updateUserWithSchemaFallback(requestPayload.userId, completeUserPatch);

  await syncPlanVisualSnapshotsForUser({
    userId: requestPayload.userId,
    plano: requestPayload.userPatch.plano,
    planoCor: requestPayload.userPatch.planoCor,
    planoIcon: requestPayload.userPatch.planoIcon,
  });

  try {
    await incrementUserStats(requestPayload.userId, {
      planUpdates: 1,
      semesterPlanActive: 1,
    });
  } catch (statsError: unknown) {
    console.warn("Planos: falha ao sincronizar upgrade de plano.", statsError);
  }

  clearAdminPlanReadCaches();
  return result;
}

export async function rejectPlanRequest(payload: {
  requestId: string;
  userId: string;
}): Promise<void> {
  const requestPayload = {
    requestId: payload.requestId.trim(),
    userId: payload.userId.trim(),
  };
  if (!requestPayload.requestId || !requestPayload.userId) return;

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    PLAN_REJECT_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const { error: requestError } = await supabase
        .from("solicitacoes_adesao")
        .update({ status: "rejeitado" })
        .eq("id", requestPayload.requestId);
      if (requestError) throwSupabaseError(requestError);

      const { error: userError } = await supabase
        .from("users")
        .update({ plano_status: "ativo" })
        .eq("uid", requestPayload.userId);
      if (userError) throwSupabaseError(userError);
      return { ok: true };
    }
  );

  clearAdminPlanReadCaches();
}

export async function deletePlanRequestAndUnlock(payload: {
  requestId: string;
  userId: string;
}): Promise<void> {
  const requestPayload = {
    requestId: payload.requestId.trim(),
    userId: payload.userId.trim(),
  };
  if (!requestPayload.requestId || !requestPayload.userId) return;

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    PLAN_DELETE_REQUEST_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const { error: deleteError } = await supabase
        .from("solicitacoes_adesao")
        .delete()
        .eq("id", requestPayload.requestId);
      if (deleteError) throwSupabaseError(deleteError);

      const { error: userError } = await supabase
        .from("users")
        .update({ plano_status: "ativo" })
        .eq("uid", requestPayload.userId);
      if (userError) throwSupabaseError(userError);
      return { ok: true };
    }
  );

  clearAdminPlanReadCaches();
}

export function clearPlansServiceCaches(): void {
  clearPlanReadCaches();
  clearAdminPlanReadCaches();
  bannerCache.clear();
  financeConfigCache.clear();
}


