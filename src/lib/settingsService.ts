import { httpsCallable } from "@/lib/supa/functions";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { getSupabaseClient } from "./supabase";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

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
  { collectionName: string; orderField: string; selectColumns: string[] }
> = {
  eventos: {
    collectionName: "solicitacoes_ingressos",
    orderField: "dataSolicitacao",
    selectColumns: [
      "id",
      "userId",
      "status",
      "eventoNome",
      "eventoId",
      "quantidade",
      "loteNome",
      "valorTotal",
      "payment_config",
      "userName",
      "userTurma",
      "dataSolicitacao",
      "createdAt",
      "data",
    ],
  },
  loja: {
    collectionName: "orders",
    orderField: "createdAt",
    selectColumns: [
      "id",
      "userId",
      "status",
      "productName",
      "productId",
      "payment_config",
      "seller_name",
      "seller_logo_url",
      "userName",
      "userTurma",
      "quantidade",
      "itens",
      "total",
      "price",
      "createdAt",
      "data",
    ],
  },
  planos: {
    collectionName: "solicitacoes_adesao",
    orderField: "dataSolicitacao",
    selectColumns: [
      "id",
      "userId",
      "status",
      "planoNome",
      "valor",
      "dataSolicitacao",
      "createdAt",
      "data",
    ],
  },
};

const menuCache = new Map<string, CacheEntry<MenuConfigSection[] | null>>();
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

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const text = [asString(raw.message), asString(raw.details)]
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!text) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(\w+)\s+does not exist/i,
    /column\s+(\w+)\s+does not exist/i,
    /could not find the ['"]?(\w+)['"]? column/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

const nowIso = (): string => new Date().toISOString();

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

const resolveMenuTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const getMenuCacheKey = (tenantId?: string | null): string =>
  resolveMenuTenantId(tenantId) || "global";

const resolveMenuDocIds = (tenantId?: string | null): string[] => {
  const scopedTenantId = resolveMenuTenantId(tenantId);
  if (!scopedTenantId) return ["menu"];
  return [buildTenantScopedRowId(scopedTenantId, "menu")];
};

const pickMenuRow = (
  rows: Array<Record<string, unknown>>,
  tenantId?: string | null
): Record<string, unknown> | null => {
  const candidates = resolveMenuDocIds(tenantId);
  for (const candidateId of candidates) {
    const match = rows.find((row) => asString(row.id).trim() === candidateId);
    if (match) return match;
  }
  return null;
};

async function saveMenuConfigWithClient(
  sections: MenuConfigSection[],
  tenantId?: string | null
): Promise<{ ok: boolean }> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveMenuTenantId(tenantId);
  const mutablePayload: Record<string, unknown> = {
    id: buildTenantScopedRowId(scopedTenantId, "menu") || "menu",
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    sections,
    data: { sections },
    updatedAt: nowIso(),
  };

  while (true) {
    const { error } = await supabase.from("app_config").upsert(mutablePayload, {
      onConflict: "id",
    });
    if (!error) break;

    const missingColumnName = asString(extractMissingSchemaColumn(error)).toLowerCase();
    if (!missingColumnName) throwSupabaseError(error);

    const removableKey = Object.keys(mutablePayload).find(
      (key) => key !== "id" && key.toLowerCase() === missingColumnName
    );
    if (!removableKey) throwSupabaseError(error);

    delete mutablePayload[String(removableKey)];
  }

  return { ok: true };
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

const mapSupabaseRowsToUserOrders = (rows: unknown[]): UserOrderRecord[] =>
  rows
    .map((row) => asObject(row))
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row) => {
      const { id, ...rest } = row;
      return {
        id: asString(id),
        data: rest,
      };
    })
    .filter((row) => row.id.length > 0);

const removeMissingColumnFromSelection = (
  columns: string[],
  missingColumn: string
): string[] | null => {
  const next = columns.filter((column) => column.toLowerCase() !== missingColumn.toLowerCase());
  if (next.length === columns.length) return null;
  return next;
};

const updateUsersWithFallback = async (
  uid: string,
  patch: Record<string, unknown>
): Promise<void> => {
  const supabase = getSupabaseClient();
  const mutablePatch = { ...patch };

  while (Object.keys(mutablePatch).length > 0) {
    const { error } = await supabase.from("users").update(mutablePatch).eq("uid", uid);
    if (!error) return;

    const missingColumnLower = asString(extractMissingSchemaColumn(error)).toLowerCase();
    if (!missingColumnLower) throwSupabaseError(error);

    const removableKey = Object.keys(mutablePatch).find(
      (key) => key.toLowerCase() === missingColumnLower
    );
    if (!removableKey) throwSupabaseError(error);
    delete mutablePatch[String(removableKey)];
  }
};

export async function fetchMenuConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<MenuConfigSection[] | null> {
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = getMenuCacheKey(options?.tenantId);

  if (!forceRefresh) {
    const cached = getMapCachedValue(menuCache, cacheKey, MENU_CACHE_TTL_MS);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns = ["id", "sections", "data"];
  let data: Record<string, unknown> | null = null;
  const docIds = resolveMenuDocIds(options?.tenantId);

  while (selectColumns.length > 0) {
    const response = await supabase
      .from("app_config")
      .select(selectColumns.join(","))
      .in("id", docIds);

    if (!response.error) {
      const rows = (Array.isArray(response.data) ? response.data : [])
        .map((row) => asObject(row))
        .filter((row): row is Record<string, unknown> => row !== null)
        .map((row) => ({ ...row }));
      data = pickMenuRow(rows, options?.tenantId);
      break;
    }

    const missingColumnName = asString(extractMissingSchemaColumn(response.error));
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumnName) ?? [];
    if (nextColumns.length === 0) throwSupabaseError(response.error);
    selectColumns = nextColumns;
  }

  if (!data) {
    setMapCachedValue(menuCache, cacheKey, null);
    return null;
  }

  const nestedData = asObject(data.data);
  const sections = sanitizeMenuSections(nestedData?.sections ?? data.sections);
  setMapCachedValue(menuCache, cacheKey, sections);
  return sections;
}

export async function saveMenuConfig(
  sections: MenuConfigSection[],
  options?: { tenantId?: string | null }
): Promise<void> {
  const normalized = sanitizeMenuSections(sections);
  const scopedTenantId = resolveMenuTenantId(options?.tenantId);

  if (scopedTenantId) {
    await saveMenuConfigWithClient(normalized, scopedTenantId);
  } else {
    await callWithFallback<
      { sections: MenuConfigSection[]; tenantId?: string },
      { ok: boolean }
    >(
      SETTINGS_SAVE_MENU_CALLABLE,
      { sections: normalized, tenantId: scopedTenantId || undefined },
      async () => saveMenuConfigWithClient(normalized, scopedTenantId)
    );
  }

  setMapCachedValue(menuCache, getMenuCacheKey(scopedTenantId), normalized);
}

export async function fetchLegalDocs(options?: {
  includeInternal?: boolean;
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<LegalDocRecord[]> {
  const includeInternal = options?.includeInternal ?? true;
  const maxResults = boundedLimit(
    options?.maxResults ?? 80,
    MAX_LEGAL_DOC_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveStoredTenantScopeId(asString(options?.tenantId).trim());
  const cacheKey = `${scopedTenantId || "global"}:${includeInternal ? "all" : "public"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(legalDocsCache, cacheKey, LEGAL_DOCS_CACHE_TTL_MS);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("legal_docs")
    .select("id,titulo,conteudo,tipo,iconName")
    .order("titulo", { ascending: true });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.limit(maxResults);
  if (error) throwSupabaseError(error);

  const docs: LegalDocRecord[] = [];
  (data ?? []).forEach((row) => {
    const normalized = normalizeLegalDoc(asString((row as Record<string, unknown>).id), row);
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
}, options?: { tenantId?: string | null }): Promise<{ id: string }> {
  const scopedTenantId = resolveStoredTenantScopeId(asString(options?.tenantId).trim());
  const safePayload = {
    titulo: payload.titulo.trim().slice(0, 120) || "Novo Regulamento",
    conteudo: payload.conteudo.slice(0, 120_000) || "Escreva aqui...",
    tipo: payload.tipo === "interno" ? "interno" : "publico",
    iconName: payload.iconName?.trim().slice(0, 40) || "FileText",
  };

  const result = await callWithFallback<
    typeof safePayload & { tenantId?: string },
    { id: string }
  >(
    SETTINGS_CREATE_DOC_CALLABLE,
    { ...safePayload, tenantId: scopedTenantId || undefined },
    async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("legal_docs")
      .insert({
        ...safePayload,
        ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
      .select("id")
      .single();
    if (error) throwSupabaseError(error);
    return { id: asString((data as Record<string, unknown> | null)?.id) };
    }
  );

  legalDocsCache.clear();
  return result;
}

export async function updateLegalDoc(
  id: string,
  payload: { titulo: string; conteudo: string },
  options?: { tenantId?: string | null }
): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;
  const scopedTenantId = resolveStoredTenantScopeId(asString(options?.tenantId).trim());

  const safePayload = {
    id: cleanId,
    titulo: payload.titulo.trim().slice(0, 120),
    conteudo: payload.conteudo.slice(0, 120_000),
  };

  await callWithFallback<typeof safePayload & { tenantId?: string }, { ok: boolean }>(
    SETTINGS_UPDATE_DOC_CALLABLE,
    { ...safePayload, tenantId: scopedTenantId || undefined },
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from("legal_docs")
        .update({
          titulo: safePayload.titulo,
          conteudo: safePayload.conteudo,
          updatedAt: nowIso(),
        })
        .eq("id", cleanId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  legalDocsCache.clear();
}

export async function removeLegalDoc(id: string, options?: { tenantId?: string | null }): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;
  const scopedTenantId = resolveStoredTenantScopeId(asString(options?.tenantId).trim());

  await callWithFallback<{ id: string; tenantId?: string }, { ok: boolean }>(
    SETTINGS_DELETE_DOC_CALLABLE,
    { id: cleanId, tenantId: scopedTenantId || undefined },
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase.from("legal_docs").delete().eq("id", cleanId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  legalDocsCache.clear();
}

export async function fetchUserOrdersByTab(
  userId: string,
  tab: OrdersTab,
  options?: { maxResults?: number; forceRefresh?: boolean; tenantId?: string | null }
): Promise<UserOrderRecord[]> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 90, MAX_ORDER_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveStoredTenantScopeId(asString(options?.tenantId).trim());
  const cacheKey = `${scopedTenantId || "global"}:${cleanUserId}:${tab}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(userOrdersCache, cacheKey, USER_ORDERS_CACHE_TTL_MS);
    if (cached) return cached;
  }

  const { collectionName, orderField, selectColumns } = ORDER_CONFIG[tab];
  const supabase = getSupabaseClient();
  let mutableColumns = [...selectColumns];
  let rows: UserOrderRecord[] = [];

  while (mutableColumns.length > 0) {
    let query = supabase
      .from(collectionName)
      .select(mutableColumns.join(","))
      .eq("userId", cleanUserId)
      .limit(maxResults);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }

    if (mutableColumns.some((column) => column.toLowerCase() === orderField.toLowerCase())) {
      query = query.order(orderField, { ascending: false });
    }

    const { data, error } = await query;
    if (!error) {
      rows = mapSupabaseRowsToUserOrders((data ?? []) as unknown[]);
      if (!mutableColumns.some((column) => column.toLowerCase() === orderField.toLowerCase())) {
        rows = sortByFieldDesc(rows, orderField);
      }
      break;
    }

    const missingColumnName = asString(extractMissingSchemaColumn(error));
    if (!missingColumnName) throwSupabaseError(error);

    const nextColumns = removeMissingColumnFromSelection(mutableColumns, missingColumnName) ?? [];
    if (nextColumns.length === 0) throwSupabaseError(error);
    mutableColumns = nextColumns;
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
    throw new Error("Usuário inválido para alteração de status.");
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
      await updateUsersWithFallback(uid, {
        status: nextStatus,
        role: nextRole,
        saved_role: isActive ? currentRole : null,
        updatedAt: nowIso(),
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
    throw new Error("Usuário inválido para exclusão.");
  }

  const requestPayload = {
    uid,
    photoUrl: payload.photoUrl?.trim() || "",
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    USER_SOFT_DELETE_CALLABLE,
    requestPayload,
    async () => {
      await updateUsersWithFallback(uid, {
        nome: "Usuário Excluído",
        email: `deleted_${uid}@usc.invalid`,
        foto: requestPayload.photoUrl || "https://github.com/shadcn.png",
        status: "deleted",
        role: "banned",
        turma: "N/A",
        deletedAt: nowIso(),
        cpf: null,
        telefone: null,
        instagram: null,
        linkedin: null,
        saved_role: null,
        updatedAt: nowIso(),
      });
      return { ok: true };
    }
  );
}
