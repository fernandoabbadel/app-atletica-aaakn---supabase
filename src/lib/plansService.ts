import { httpsCallable } from "firebase/functions";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { db, functions } from "./firebase";
import { getFirebaseErrorCode } from "./firebaseErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 35_000;

const MAX_PLAN_RESULTS = 60;
const MAX_SUBSCRIPTION_RESULTS = 900;
const MAX_REQUEST_RESULTS = 500;
const MAX_USER_REQUEST_RESULTS = 90;

const PLAN_CREATE_REQUEST_CALLABLE = "planCreateAdhesionRequest";
const PLAN_UPSERT_CALLABLE = "planAdminUpsert";
const PLAN_DELETE_CALLABLE = "planAdminDelete";
const PLAN_SEED_CALLABLE = "planAdminSeedDefaults";
const PLAN_APPROVE_CALLABLE = "planAdminApproveRequest";
const PLAN_REJECT_CALLABLE = "planAdminRejectRequest";
const PLAN_DELETE_REQUEST_CALLABLE = "planAdminDeleteRequest";
const PLAN_SAVE_BANNER_CALLABLE = "planAdminSaveBanner";

const plansCache = new Map<string, CacheEntry<PlanRecord[]>>();
const planByIdCache = new Map<string, CacheEntry<PlanRecord | null>>();
const subscriptionsCache = new Map<string, CacheEntry<PlanSubscriptionRecord[]>>();
const adminRequestsCache = new Map<string, CacheEntry<PlanRequestRecord[]>>();
const userRequestsCache = new Map<string, CacheEntry<PlanRequestRecord[]>>();
let bannerCache: CacheEntry<BannerConfigRecord> | null = null;
let financeConfigCache: CacheEntry<FinanceConfigRecord> | null = null;

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

const shouldFallbackToClientWrites = (error: unknown): boolean => {
  const code = getFirebaseErrorCode(error)?.toLowerCase();
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
  const code = getFirebaseErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }

  return false;
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

const DEFAULT_BANNER_CONFIG: BannerConfigRecord = {
  titulo: "VIRE TUBARAO REI",
  subtitulo: "Domine o Oceano",
  cor: "dourado",
};

const DEFAULT_FINANCE_CONFIG: FinanceConfigRecord = {
  chave: "financeiro@aaakn.com.br",
  banco: "Banco Inter",
  titular: "Assoc. Atletica Acad. Knight",
};

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
});

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
}): Promise<PlanRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 24, MAX_PLAN_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(plansCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(collection(db, "planos"), orderBy("precoVal", "asc"), limit(maxResults));
  const snap = await getDocs(q);
  const plans = snap.docs
    .map((row) => normalizePlan(row.id, row.data()))
    .filter((row): row is PlanRecord => row !== null);

  setMapCachedValue(plansCache, cacheKey, plans);
  return plans;
}

export async function fetchPlanById(
  planId: string,
  options?: { forceRefresh?: boolean }
): Promise<PlanRecord | null> {
  const cleanId = planId.trim();
  if (!cleanId) return null;

  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh) {
    const cachedEntry = planByIdCache.get(cleanId);
    if (cachedEntry) {
      if (Date.now() - cachedEntry.cachedAt <= READ_CACHE_TTL_MS) {
        return cachedEntry.value;
      }
      planByIdCache.delete(cleanId);
    }
  }

  const snap = await getDoc(doc(db, "planos", cleanId));
  if (!snap.exists()) {
    setMapCachedValue(planByIdCache, cleanId, null);
    return null;
  }

  const plan = normalizePlan(snap.id, snap.data());
  setMapCachedValue(planByIdCache, cleanId, plan);
  return plan;
}

export async function fetchPlanSubscriptions(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<PlanSubscriptionRecord[]> {
  const maxResults = boundedLimit(
    options?.maxResults ?? 480,
    MAX_SUBSCRIPTION_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(subscriptionsCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(
    collection(db, "assinaturas"),
    orderBy("dataInicio", "desc"),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((row) => normalizeSubscription(row.id, row.data()))
    .filter((row): row is PlanSubscriptionRecord => row !== null);

  setMapCachedValue(subscriptionsCache, cacheKey, rows);
  return rows;
}

export async function fetchPlanRequests(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<PlanRequestRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 260, MAX_REQUEST_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(adminRequestsCache, cacheKey);
    if (cached) return cached;
  }

  let rows: PlanRequestRecord[] = [];
  try {
    const q = query(
      collection(db, "solicitacoes_adesao"),
      orderBy("dataSolicitacao", "desc"),
      limit(maxResults)
    );
    const snap = await getDocs(q);
    rows = snap.docs
      .map((row) => normalizeRequest(row.id, row.data()))
      .filter((row): row is PlanRequestRecord => row !== null);
  } catch (error: unknown) {
    if (!isIndexRequiredError(error)) {
      throw error;
    }

    const fallbackQ = query(collection(db, "solicitacoes_adesao"), limit(maxResults));
    const fallbackSnap = await getDocs(fallbackQ);
    rows = sortByDateDesc(
      fallbackSnap.docs
        .map((row) => normalizeRequest(row.id, row.data()))
        .filter((row): row is PlanRequestRecord => row !== null),
      (entry) => entry.dataSolicitacao
    );
  }

  setMapCachedValue(adminRequestsCache, cacheKey, rows);
  return rows;
}

export async function fetchUserPlanRequests(
  userId: string,
  options?: { maxResults?: number; forceRefresh?: boolean }
): Promise<PlanRequestRecord[]> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return [];

  const maxResults = boundedLimit(
    options?.maxResults ?? 30,
    MAX_USER_REQUEST_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${cleanUserId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(userRequestsCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(
    collection(db, "solicitacoes_adesao"),
    where("userId", "==", cleanUserId),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  const rows = sortByDateDesc(
    snap.docs
      .map((row) => normalizeRequest(row.id, row.data()))
      .filter((row): row is PlanRequestRecord => row !== null),
    (entry) => entry.dataSolicitacao
  );

  setMapCachedValue(userRequestsCache, cacheKey, rows);
  return rows;
}

export async function fetchMarketingBannerConfig(options?: {
  forceRefresh?: boolean;
}): Promise<BannerConfigRecord> {
  const forceRefresh = options?.forceRefresh ?? false;
  if (
    !forceRefresh &&
    bannerCache &&
    Date.now() - bannerCache.cachedAt <= READ_CACHE_TTL_MS
  ) {
    return bannerCache.value;
  }

  const snap = await getDoc(doc(db, "app_config", "marketing_banner"));
  const normalized = snap.exists()
    ? normalizeBannerConfig(snap.data())
    : DEFAULT_BANNER_CONFIG;

  bannerCache = { cachedAt: Date.now(), value: normalized };
  return normalized;
}

export async function fetchFinanceConfig(options?: {
  forceRefresh?: boolean;
}): Promise<FinanceConfigRecord> {
  const forceRefresh = options?.forceRefresh ?? false;
  if (
    !forceRefresh &&
    financeConfigCache &&
    Date.now() - financeConfigCache.cachedAt <= READ_CACHE_TTL_MS
  ) {
    return financeConfigCache.value;
  }

  const snap = await getDoc(doc(db, "app_config", "financeiro"));
  const normalized = snap.exists()
    ? normalizeFinanceConfig(snap.data())
    : DEFAULT_FINANCE_CONFIG;

  financeConfigCache = { cachedAt: Date.now(), value: normalized };
  return normalized;
}

export async function createPlanRequest(payload: {
  userId: string;
  userName: string;
  userTurma: string;
  planoId: string;
  planoNome: string;
  valor: number;
}): Promise<{ id: string }> {
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
      const ref = await addDoc(collection(db, "solicitacoes_adesao"), {
        ...requestPayload,
        dataSolicitacao: serverTimestamp(),
        status: "pendente",
        metodo: "whatsapp",
      });
      return { id: ref.id };
    }
  );

  clearAdminPlanReadCaches();
  return result;
}

export async function upsertPlan(payload: {
  id?: string;
  data: Partial<PlanRecord>;
}): Promise<{ id: string }> {
  const id = payload.id?.trim() || "";
  const normalizedData = normalizePlanPayload(payload.data);
  const requestPayload = { id, data: normalizedData };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    PLAN_UPSERT_CALLABLE,
    requestPayload,
    async () => {
      if (id) {
        await updateDoc(doc(db, "planos", id), normalizedData);
        return { id };
      }

      const ref = await addDoc(collection(db, "planos"), normalizedData);
      return { id: ref.id };
    }
  );

  clearPlanReadCaches();
  return result;
}

export async function deletePlan(planId: string): Promise<void> {
  const cleanId = planId.trim();
  if (!cleanId) return;

  await callWithFallback<{ id: string }, { ok: boolean }>(
    PLAN_DELETE_CALLABLE,
    { id: cleanId },
    async () => {
      await deleteDoc(doc(db, "planos", cleanId));
      return { ok: true };
    }
  );

  clearPlanReadCaches();
}

export async function seedDefaultPlans(entries: Partial<PlanRecord>[]): Promise<void> {
  const safeEntries = entries
    .slice(0, MAX_PLAN_RESULTS)
    .map((entry) => normalizePlanPayload(entry));

  await callWithFallback<{ plans: Omit<PlanRecord, "id">[] }, { ok: boolean }>(
    PLAN_SEED_CALLABLE,
    { plans: safeEntries },
    async () => {
      for (const entry of safeEntries) {
        await addDoc(collection(db, "planos"), entry);
      }
      return { ok: true };
    }
  );

  clearPlanReadCaches();
}

export async function saveMarketingBannerConfig(
  config: BannerConfigRecord
): Promise<void> {
  const normalized = normalizeBannerConfig(config);

  await callWithFallback<{ config: BannerConfigRecord }, { ok: boolean }>(
    PLAN_SAVE_BANNER_CALLABLE,
    { config: normalized },
    async () => {
      await setDoc(doc(db, "app_config", "marketing_banner"), normalized);
      return { ok: true };
    }
  );

  bannerCache = { cachedAt: Date.now(), value: normalized };
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

  if (!requestPayload.requestId || !requestPayload.userId) {
    throw new Error("Solicitacao invalida para aprovacao.");
  }

  const result = await callWithFallback<
    typeof requestPayload,
    { subscriptionId: string }
  >(PLAN_APPROVE_CALLABLE, requestPayload, async () => {
    const batch = writeBatch(db);
    batch.update(doc(db, "solicitacoes_adesao", requestPayload.requestId), {
      status: "aprovado",
    });

    batch.update(doc(db, "users", requestPayload.userId), {
      plano: requestPayload.userPatch.plano,
      plano_badge: requestPayload.userPatch.planoBadge,
      plano_cor: requestPayload.userPatch.planoCor,
      plano_icon: requestPayload.userPatch.planoIcon,
      tier: requestPayload.userPatch.tier,
      xpMultiplier: requestPayload.userPatch.xpMultiplier,
      nivel_prioridade: requestPayload.userPatch.nivelPrioridade,
      desconto_loja: requestPayload.userPatch.descontoLoja,
      plano_status: "ativo",
      data_adesao: new Date().toISOString(),
    });

    const subscriptionRef = doc(collection(db, "assinaturas"));
    batch.set(subscriptionRef, {
      aluno: requestPayload.userName,
      turma: requestPayload.userTurma,
      planoId: requestPayload.planoId,
      planoNome: requestPayload.planoNome,
      valorPago: requestPayload.valor,
      dataInicio: new Date().toLocaleDateString("pt-BR"),
      status: "ativo",
      metodo: "pix",
      userId: requestPayload.userId,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return { subscriptionId: subscriptionRef.id };
  });

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
      const batch = writeBatch(db);
      batch.update(doc(db, "solicitacoes_adesao", requestPayload.requestId), {
        status: "rejeitado",
      });
      batch.update(doc(db, "users", requestPayload.userId), {
        plano_status: "ativo",
      });
      await batch.commit();
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
      const batch = writeBatch(db);
      batch.delete(doc(db, "solicitacoes_adesao", requestPayload.requestId));
      batch.update(doc(db, "users", requestPayload.userId), {
        plano_status: "ativo",
      });
      await batch.commit();
      return { ok: true };
    }
  );

  clearAdminPlanReadCaches();
}

export function clearPlansServiceCaches(): void {
  clearPlanReadCaches();
  clearAdminPlanReadCaches();
  bannerCache = null;
  financeConfigCache = null;
}
