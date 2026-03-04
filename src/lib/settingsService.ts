import { httpsCallable } from "@/lib/supa/functions";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
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
} from "@/lib/supabaseHelpers";

import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const MENU_CACHE_TTL_MS = 60_000;
const LEGAL_DOCS_CACHE_TTL_MS = 60_000;
const USER_ORDERS_CACHE_TTL_MS = 45_000;

const MAX_MENU_SECTIONS = 12;
const MAX_MENU_ITEMS_PER_SECTION = 40;
const MAX_LEGAL_DOC_RESULTS = 120;
const MAX_ORDER_RESULTS = 150;

const SETTINGS_SAVE_MENU_CALLABLE = "settingsSaveMenuConfig";
const SETTINGS_CREATE_DOC_CALLABLE = "settingsCreateLegalDoc";
const SETTINGS_UPDATE_DOC_CALLABLE = "settingsUpdateLegalDoc";
const SETTINGS_DELETE_DOC_CALLABLE = "settingsDeleteLegalDoc";
const USER_TOGGLE_STATUS_CALLABLE = "userToggleAccountStatus";
const USER_SOFT_DELETE_CALLABLE = "userSoftDeleteAccount";

type MenuItemType = "link" | "toggle" | "action";

export interface MenuConfigItem {
  id: string;
  label: string;
  icon: string;
  type: MenuItemType;
  path?: string;
  active: boolean;
}

export interface MenuConfigSection {
  id: string;
  title: string;
  items: MenuConfigItem[];
}

export type LegalDocType = "publico" | "interno";

export interface LegalDocRecord {
  id: string;
  titulo: string;
  conteudo: string;
  tipo: LegalDocType;
  iconName: string;
}

export type OrdersTab = "eventos" | "loja" | "planos";

export interface UserOrderRecord {
  id: string;
  data: Record<string, unknown>;
}

const ORDER_CONFIG: Record<
  OrdersTab,
  { collectionName: string; orderField: string }
> = {
  eventos: { collectionName: "solicitacoes_ingressos", orderField: "dataSolicitacao" },
  loja: { collectionName: "pedidos_loja", orderField: "createdAt" },
  planos: { collectionName: "solicitacoes_adesao", orderField: "dataSolicitacao" },
};

let menuCache: CacheEntry<MenuConfigSection[] | null> | null = null;
const legalDocsCache = new Map<string, CacheEntry<LegalDocRecord[]>>();
const userOrdersCache = new Map<string, CacheEntry<UserOrderRecord[]>>();

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getCachedValue = <T>(
  cache: CacheEntry<T> | null,
  ttlMs: number
): T | null => {
  if (!cache) return null;
  if (Date.now() - cache.cachedAt > ttlMs) return null;
  return cache.value;
};

const getMapCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number
): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > ttlMs) {
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

const sanitizeMenuSections = (raw: unknown): MenuConfigSection[] => {
  if (!Array.isArray(raw)) return [];

  const normalized: MenuConfigSection[] = [];
  for (const sectionEntry of raw.slice(0, MAX_MENU_SECTIONS)) {
    const sectionObj = asObject(sectionEntry);
    if (!sectionObj) continue;

    const sectionId = asString(sectionObj.id).trim() || crypto.randomUUID();
    const title = asString(sectionObj.title, "Secao").trim().slice(0, 60);
    const rawItems = Array.isArray(sectionObj.items) ? sectionObj.items : [];

    const items: MenuConfigItem[] = [];
    for (const itemEntry of rawItems.slice(0, MAX_MENU_ITEMS_PER_SECTION)) {
      const itemObj = asObject(itemEntry);
      if (!itemObj) continue;

      const typeRaw = asString(itemObj.type, "link");
      const type: MenuItemType =
        typeRaw === "toggle" || typeRaw === "action" ? typeRaw : "link";

      items.push({
        id: asString(itemObj.id).trim() || crypto.randomUUID(),
        label: asString(itemObj.label, "Item").trim().slice(0, 80),
        icon: asString(itemObj.icon, "Settings").trim().slice(0, 40),
        type,
        path: asString(itemObj.path).trim().slice(0, 180) || undefined,
        active: asBoolean(itemObj.active, true),
      });
    }

    normalized.push({
      id: sectionId,
      title: title || "Secao",
      items,
    });
  }

  return normalized;
};

const normalizeLegalDoc = (id: string, raw: unknown): LegalDocRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  const tipoRaw = asString(obj.tipo, "publico");
  const tipo: LegalDocType = tipoRaw === "interno" ? "interno" : "publico";

  return {
    id,
    titulo: asString(obj.titulo, "Sem titulo").trim().slice(0, 120),
    conteudo: asString(obj.conteudo).slice(0, 120_000),
    tipo,
    iconName: asString(obj.iconName, "FileText").trim().slice(0, 40) || "FileText",
  };
};

const toMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (typeof value === "object" && value !== null) {
    const candidate = (value as { toDate?: unknown }).toDate;
    if (typeof candidate === "function") {
      const result = candidate.call(value) as Date;
      if (result instanceof Date) return result.getTime();
    }
  }

  return 0;
};

const sortByFieldDesc = (
  rows: UserOrderRecord[],
  orderField: string
): UserOrderRecord[] =>
  [...rows].sort(
    (left, right) =>
      toMillis(right.data[orderField]) - toMillis(left.data[orderField])
  );

export async function fetchMenuConfig(options?: {
  forceRefresh?: boolean;
}): Promise<MenuConfigSection[] | null> {
  const forceRefresh = options?.forceRefresh ?? false;

  if (!forceRefresh) {
    const cached = getCachedValue(menuCache, MENU_CACHE_TTL_MS);
    if (cached) return cached;
  }

  const snap = await getDoc(doc(db, "app_config", "menu"));
  if (!snap.exists()) {
    menuCache = { cachedAt: Date.now(), value: null };
    return null;
  }

  const sections = sanitizeMenuSections((snap.data() as { sections?: unknown }).sections);
  menuCache = { cachedAt: Date.now(), value: sections };
  return sections;
}

export async function saveMenuConfig(
  sections: MenuConfigSection[]
): Promise<void> {
  const normalized = sanitizeMenuSections(sections);

  await callWithFallback<{ sections: MenuConfigSection[] }, { ok: boolean }>(
    SETTINGS_SAVE_MENU_CALLABLE,
    { sections: normalized },
    async () => {
      await setDoc(doc(db, "app_config", "menu"), {
        sections: normalized,
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  menuCache = { cachedAt: Date.now(), value: normalized };
}

export async function fetchLegalDocs(options?: {
  includeInternal?: boolean;
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<LegalDocRecord[]> {
  const includeInternal = options?.includeInternal ?? true;
  const maxResults = boundedLimit(
    options?.maxResults ?? 80,
    MAX_LEGAL_DOC_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${includeInternal ? "all" : "public"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(legalDocsCache, cacheKey, LEGAL_DOCS_CACHE_TTL_MS);
    if (cached) return cached;
  }

  const q = query(collection(db, "legal_docs"), orderBy("titulo", "asc"), limit(maxResults));
  const snap = await getDocs(q);

  const docs: LegalDocRecord[] = [];
  snap.forEach((row) => {
    const normalized = normalizeLegalDoc(row.id, row.data());
    if (!normalized) return;
    if (!includeInternal && normalized.tipo !== "publico") return;
    docs.push(normalized);
  });

  setMapCachedValue(legalDocsCache, cacheKey, docs);
  return docs;
}

export async function createLegalDoc(payload: {
  titulo: string;
  conteudo: string;
  tipo?: LegalDocType;
  iconName?: string;
}): Promise<{ id: string }> {
  const safePayload = {
    titulo: payload.titulo.trim().slice(0, 120) || "Novo Regulamento",
    conteudo: payload.conteudo.slice(0, 120_000) || "Escreva aqui...",
    tipo: payload.tipo === "interno" ? "interno" : "publico",
    iconName: payload.iconName?.trim().slice(0, 40) || "FileText",
  };

  const result = await callWithFallback<
    typeof safePayload,
    { id: string }
  >(SETTINGS_CREATE_DOC_CALLABLE, safePayload, async () => {
    const ref = await addDoc(collection(db, "legal_docs"), {
      ...safePayload,
      createdAt: serverTimestamp(),
    });
    return { id: ref.id };
  });

  legalDocsCache.clear();
  return result;
}

export async function updateLegalDoc(
  id: string,
  payload: { titulo: string; conteudo: string }
): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;

  const safePayload = {
    id: cleanId,
    titulo: payload.titulo.trim().slice(0, 120),
    conteudo: payload.conteudo.slice(0, 120_000),
  };

  await callWithFallback<typeof safePayload, { ok: boolean }>(
    SETTINGS_UPDATE_DOC_CALLABLE,
    safePayload,
    async () => {
      await updateDoc(doc(db, "legal_docs", cleanId), {
        titulo: safePayload.titulo,
        conteudo: safePayload.conteudo,
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  legalDocsCache.clear();
}

export async function removeLegalDoc(id: string): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;

  await callWithFallback<{ id: string }, { ok: boolean }>(
    SETTINGS_DELETE_DOC_CALLABLE,
    { id: cleanId },
    async () => {
      await deleteDoc(doc(db, "legal_docs", cleanId));
      return { ok: true };
    }
  );

  legalDocsCache.clear();
}

export async function fetchUserOrdersByTab(
  userId: string,
  tab: OrdersTab,
  options?: { maxResults?: number; forceRefresh?: boolean }
): Promise<UserOrderRecord[]> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 90, MAX_ORDER_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${cleanUserId}:${tab}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(userOrdersCache, cacheKey, USER_ORDERS_CACHE_TTL_MS);
    if (cached) return cached;
  }

  const { collectionName, orderField } = ORDER_CONFIG[tab];
  let rows: UserOrderRecord[] = [];

  try {
    const q = query(
      collection(db, collectionName),
      where("userId", "==", cleanUserId),
      orderBy(orderField, "desc"),
      limit(maxResults)
    );
    const snap = await getDocs(q);
    rows = snap.docs.map((row) => ({
      id: row.id,
      data: row.data() as Record<string, unknown>,
    }));
  } catch (error: unknown) {
    if (!isIndexRequiredError(error)) {
      throw error;
    }

    const fallbackQuery = query(
      collection(db, collectionName),
      where("userId", "==", cleanUserId),
      limit(maxResults)
    );
    const fallbackSnap = await getDocs(fallbackQuery);
    rows = sortByFieldDesc(
      fallbackSnap.docs.map((row) => ({
        id: row.id,
        data: row.data() as Record<string, unknown>,
      })),
      orderField
    );
  }

  setMapCachedValue(userOrdersCache, cacheKey, rows);
  return rows;
}

export async function toggleAccountStatus(payload: {
  uid: string;
  currentStatus?: string;
  currentRole?: string;
  savedRole?: string | null;
}): Promise<{ nextStatus: "ativo" | "paused"; nextRole: string }> {
  const uid = payload.uid.trim();
  if (!uid) {
    throw new Error("Usuario invalido para alteracao de status.");
  }

  const isActive = payload.currentStatus === "ativo";
  const nextStatus: "ativo" | "paused" = isActive ? "paused" : "ativo";
  const savedRole = payload.savedRole?.trim() || null;
  const currentRole = payload.currentRole?.trim() || "user";
  const nextRole = isActive ? "inactive" : savedRole || currentRole || "user";

  const requestPayload = {
    uid,
    nextStatus,
    nextRole,
    savedRole: isActive ? currentRole : null,
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    USER_TOGGLE_STATUS_CALLABLE,
    requestPayload,
    async () => {
      await updateDoc(doc(db, "users", uid), {
        status: nextStatus,
        role: nextRole,
        saved_role: isActive ? currentRole : null,
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  return { nextStatus, nextRole };
}

export async function softDeleteAccount(payload: {
  uid: string;
  photoUrl?: string;
}): Promise<void> {
  const uid = payload.uid.trim();
  if (!uid) {
    throw new Error("Usuario invalido para exclusao.");
  }

  const requestPayload = {
    uid,
    photoUrl: payload.photoUrl?.trim() || "",
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    USER_SOFT_DELETE_CALLABLE,
    requestPayload,
    async () => {
      await updateDoc(doc(db, "users", uid), {
        nome: "Usuario Excluido",
        email: `deleted_${uid}@aaakn.com`,
        foto: requestPayload.photoUrl || "https://github.com/shadcn.png",
        status: "deleted",
        role: "banned",
        turma: "N/A",
        deletedAt: serverTimestamp(),
        cpf: deleteField(),
        telefone: deleteField(),
        instagram: deleteField(),
        linkedin: deleteField(),
        saved_role: deleteField(),
      });
      return { ok: true };
    }
  );
}


