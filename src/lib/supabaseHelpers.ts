import { getSupabaseClient } from "./supabase";

// Camada de compatibilidade para manter a API usada pelo app,
// mas executando em tabelas do Supabase (sem realtime por padrao).

type Primitive = string | number | boolean | null;

type Row = Record<string, unknown>;

type SentinelValue =
  | { __kind: "serverTimestamp" }
  | { __kind: "increment"; amount: number }
  | { __kind: "arrayUnion"; values: unknown[] }
  | { __kind: "arrayRemove"; values: unknown[] }
  | { __kind: "deleteField" };

type QueryWhereConstraint = {
  type: "where";
  field: string;
  op: string;
  value: unknown;
};

type QueryOrderConstraint = {
  type: "orderBy";
  field: string;
  direction: "asc" | "desc";
};

type QueryLimitConstraint = {
  type: "limit";
  count: number;
};

type QueryStartAfterConstraint = {
  type: "startAfter";
  cursorId: string;
};

export type QueryConstraint =
  | QueryWhereConstraint
  | QueryOrderConstraint
  | QueryLimitConstraint
  | QueryStartAfterConstraint;

export interface FirestoreInstance {
  kind: "supa-firestore";
  options: Record<string, unknown>;
}

export interface CollectionReference {
  kind: "collection";
  path: string;
  segments: string[];
  table: string;
  collectionName: string;
  parentDocs: Array<{ collection: string; id: string }>;
}

export interface DocumentReference {
  kind: "document";
  path: string;
  segments: string[];
  id: string;
  parent: CollectionReference;
}

export interface QueryReference {
  kind: "query";
  collection: CollectionReference;
  constraints: QueryConstraint[];
}

export interface DocumentSnapshot<T = unknown> {
  id: string;
  ref: DocumentReference;
  exists(): boolean;
  data(): T;
}

export interface QuerySnapshot<T = Row> {
  docs: Array<QueryDocumentSnapshot<T>>;
  empty: boolean;
  size: number;
  forEach(
    callback: (snapshot: QueryDocumentSnapshot<T>) => void
  ): void;
}

export interface QueryDocumentSnapshot<T = Row> extends DocumentSnapshot<T> {
  exists(): true;
}

export type DocumentData = Row;
type WritableInput = Record<string, unknown> | object;

const LISTENER_SET = new Map<string, Set<() => void>>();

const emitPathChange = (path: string): void => {
  const normalized = normalizePath(path);
  for (const [watchedPath, callbacks] of LISTENER_SET.entries()) {
    if (normalized === watchedPath || normalized.startsWith(`${watchedPath}/`)) {
      for (const cb of callbacks) {
        try {
          cb();
        } catch (error: unknown) {
          console.error("Erro em listener de dados:", error);
        }
      }
    }
  }
};

const subscribePathChange = (path: string, cb: () => void): (() => void) => {
  const normalized = normalizePath(path);
  const set = LISTENER_SET.get(normalized) ?? new Set<() => void>();
  set.add(cb);
  LISTENER_SET.set(normalized, set);

  return () => {
    const current = LISTENER_SET.get(normalized);
    if (!current) return;
    current.delete(cb);
    if (!current.size) {
      LISTENER_SET.delete(normalized);
    }
  };
};

export class Timestamp {
  private readonly dateValue: Date;

  constructor(secondsOrDate: number | Date, nanoseconds = 0) {
    if (secondsOrDate instanceof Date) {
      this.dateValue = new Date(secondsOrDate.getTime());
      return;
    }

    const millis = secondsOrDate * 1000 + Math.floor(nanoseconds / 1_000_000);
    this.dateValue = new Date(millis);
  }

  static now(): Timestamp {
    return new Timestamp(new Date());
  }

  static fromDate(date: Date): Timestamp {
    return new Timestamp(date);
  }

  static fromMillis(millis: number): Timestamp {
    return new Timestamp(new Date(millis));
  }

  toDate(): Date {
    return new Date(this.dateValue.getTime());
  }

  toMillis(): number {
    return this.dateValue.getTime();
  }

  isEqual(other: Timestamp): boolean {
    return this.toMillis() === other.toMillis();
  }

  get seconds(): number {
    return Math.floor(this.dateValue.getTime() / 1000);
  }

  get nanoseconds(): number {
    return (this.dateValue.getTime() % 1000) * 1_000_000;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSentinel = (value: unknown): value is SentinelValue =>
  isObject(value) && typeof value.__kind === "string";

const normalizePath = (path: string): string => path.split("/").filter(Boolean).join("/");

const normalizeSegments = (segments: string[]): string[] =>
  segments.map((segment) => String(segment).trim()).filter(Boolean);

const singularize = (value: string): string => {
  if (value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.endsWith("s") && value.length > 1) return value.slice(0, -1);
  return value;
};

const getCollectionNames = (segments: string[]): string[] =>
  segments.filter((_, index) => index % 2 === 0);

type PrimaryKeyColumn = "id" | "uid" | "userId";

type CompatTableConfig = {
  primaryKey: PrimaryKeyColumn;
};

const COMPAT_TABLE_CONFIG: Readonly<Record<string, CompatTableConfig>> = {
  achievements_logs: { primaryKey: "id" },
  activity_logs: { primaryKey: "id" },
  album_config: { primaryKey: "id" },
  album_rankings: { primaryKey: "id" },
  album_summary: { primaryKey: "userId" },
  app_config: { primaryKey: "id" },
  arena_matches: { primaryKey: "id" },
  assinaturas: { primaryKey: "id" },
  banned_appeals: { primaryKey: "id" },
  categorias: { primaryKey: "id" },
  denuncias: { primaryKey: "id" },
  eventos: { primaryKey: "id" },
  eventos_comentarios: { primaryKey: "id" },
  eventos_enquetes: { primaryKey: "id" },
  eventos_rsvps: { primaryKey: "id" },
  guia_data: { primaryKey: "id" },
  historic_events: { primaryKey: "id" },
  legal_docs: { primaryKey: "id" },
  ligas_config: { primaryKey: "id" },
  notifications: { primaryKey: "id" },
  orders: { primaryKey: "id" },
  parceiros: { primaryKey: "id" },
  planos: { primaryKey: "id" },
  posts: { primaryKey: "id" },
  posts_comments: { primaryKey: "id" },
  produtos: { primaryKey: "id" },
  quiz_history: { primaryKey: "id" },
  reviews: { primaryKey: "id" },
  scans: { primaryKey: "id" },
  settings: { primaryKey: "id" },
  site_config: { primaryKey: "id" },
  solicitacoes_adesao: { primaryKey: "id" },
  solicitacoes_ingressos: { primaryKey: "id" },
  store_rewards: { primaryKey: "id" },
  store_redemptions: { primaryKey: "id" },
  support_requests: { primaryKey: "id" },
  treinos: { primaryKey: "id" },
  treinos_chamada: { primaryKey: "id" },
  treinos_rsvps: { primaryKey: "id" },
  users: { primaryKey: "uid" },
  users_albumColado: { primaryKey: "id" },
  users_followers: { primaryKey: "id" },
  users_following: { primaryKey: "id" },
} as const;

const COLLECTION_PATH_TABLE_ALIASES: Readonly<Record<string, string>> = {
  "users/*/quiz_history": "quiz_history",
} as const;

const getParentDocs = (segments: string[]): Array<{ collection: string; id: string }> => {
  const parents: Array<{ collection: string; id: string }> = [];
  for (let i = 0; i < segments.length - 1; i += 2) {
    parents.push({ collection: segments[i], id: segments[i + 1] });
  }
  return parents;
};

const getCollectionPathPattern = (segments: string[]): string =>
  segments
    .map((segment, index) => (index % 2 === 0 ? segment : "*"))
    .join("/");

const getTableFromCollectionSegments = (segments: string[]): string => {
  const pattern = getCollectionPathPattern(segments);
  const aliasTable = COLLECTION_PATH_TABLE_ALIASES[pattern];
  if (aliasTable) return aliasTable;
  return getCollectionNames(segments).join("_");
};

const getCompatTableConfig = (table: string): CompatTableConfig => {
  const config = COMPAT_TABLE_CONFIG[table];
  if (config) return config;

  const message =
    `Compat Firestore sem mapeamento explicito para a tabela "${table}". ` +
    "Adicione a tabela em COMPAT_TABLE_CONFIG (src/lib/supabaseHelpers.ts) antes de usar.";
  console.error(message);
  throw new Error(message);
};

const getPrimaryIdCandidates = (ref: DocumentReference): string[] => {
  const table = ref.parent.table;
  return [getCompatTableConfig(table).primaryKey];
};

const getParentForeignKeyColumn = (collectionName: string): string =>
  `${singularize(collectionName)}Id`;

const buildParentMetadata = (collectionRef: CollectionReference): Row => {
  if (!collectionRef.parentDocs.length) return {};

  const metadata: Row = {};

  for (const parent of collectionRef.parentDocs) {
    metadata[getParentForeignKeyColumn(parent.collection)] = parent.id;
  }

  return metadata;
};

const cloneDeep = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const setAtPath = (target: Row, path: string[], value: unknown): void => {
  let cursor: Row = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const current = cursor[key];
    if (!isObject(current)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Row;
  }
  cursor[path[path.length - 1]] = value;
};

const deleteAtPath = (target: Row, path: string[]): void => {
  if (!path.length) return;
  let cursor: Row = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const next = cursor[key];
    if (!isObject(next)) return;
    cursor = next;
  }
  delete cursor[path[path.length - 1]];
};

const getAtPath = (target: Row, path: string[]): unknown => {
  let cursor: unknown = target;
  for (const key of path) {
    if (!isObject(cursor) || !(key in cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
};

const removeDuplicates = (values: unknown[]): unknown[] => {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
};

const applySentinelToCurrent = (current: unknown, sentinel: SentinelValue): unknown => {
  switch (sentinel.__kind) {
    case "serverTimestamp":
      return new Date().toISOString();
    case "increment": {
      const currentNumber = typeof current === "number" && Number.isFinite(current) ? current : 0;
      return currentNumber + sentinel.amount;
    }
    case "arrayUnion": {
      const base = Array.isArray(current) ? current : [];
      return removeDuplicates([...base, ...sentinel.values]);
    }
    case "arrayRemove": {
      const base = Array.isArray(current) ? current : [];
      const removeKeys = new Set(sentinel.values.map((value) => JSON.stringify(value)));
      return base.filter((item) => !removeKeys.has(JSON.stringify(item)));
    }
    case "deleteField":
      return undefined;
  }
};

const normalizeForWrite = (value: unknown): unknown => {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForWrite(entry));
  }
  if (isObject(value)) {
    if (isSentinel(value)) {
      return applySentinelToCurrent(undefined, value);
    }

    const output: Row = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = normalizeForWrite(entry);
    }
    return output;
  }
  return value;
};

const applyPatch = (baseRow: Row, patch: Row): Row => {
  const next = cloneDeep(baseRow);

  for (const [rawKey, rawValue] of Object.entries(patch)) {
    const path = rawKey.split(".").filter(Boolean);
    if (!path.length) continue;

    const current = getAtPath(next, path);
    if (isSentinel(rawValue) && rawValue.__kind === "deleteField") {
      deleteAtPath(next, path);
      continue;
    }

    const normalizedValue = isSentinel(rawValue)
      ? applySentinelToCurrent(current, rawValue)
      : normalizeForWrite(rawValue);

    setAtPath(next, path, normalizedValue);
  }

  return next;
};

const mergeObjects = (base: Row, incoming: Row): Row => {
  const next = cloneDeep(base);
  for (const [key, value] of Object.entries(incoming)) {
    if (isSentinel(value) && value.__kind === "deleteField") {
      delete next[key];
      continue;
    }

    const normalized = normalizeForWrite(value);
    if (isObject(next[key]) && isObject(normalized)) {
      next[key] = mergeObjects(next[key] as Row, normalized as Row);
    } else {
      next[key] = normalized;
    }
  }
  return next;
};

const compareValues = (left: unknown, right: unknown): number => {
  const leftMillis = toMillis(left);
  const rightMillis = toMillis(right);
  if (leftMillis || rightMillis) {
    return leftMillis - rightMillis;
  }

  if (typeof left === "number" && typeof right === "number") return left - right;
  const leftString = typeof left === "string" ? left : JSON.stringify(left ?? null);
  const rightString = typeof right === "string" ? right : JSON.stringify(right ?? null);
  return leftString.localeCompare(rightString);
};

const toMillis = (value: unknown): number => {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (isObject(value) && typeof value.toDate === "function") {
    const date = value.toDate() as Date;
    if (date instanceof Date) return date.getTime();
  }
  return 0;
};

const valueMatchesWhere = (candidate: unknown, op: string, expected: unknown): boolean => {
  switch (op) {
    case "==":
      return JSON.stringify(candidate ?? null) === JSON.stringify(expected ?? null);
    case "!=":
      return JSON.stringify(candidate ?? null) !== JSON.stringify(expected ?? null);
    case "<":
      return compareValues(candidate, expected) < 0;
    case "<=":
      return compareValues(candidate, expected) <= 0;
    case ">":
      return compareValues(candidate, expected) > 0;
    case ">=":
      return compareValues(candidate, expected) >= 0;
    case "in":
      return Array.isArray(expected)
        ? expected.some((entry) => JSON.stringify(entry) === JSON.stringify(candidate))
        : false;
    case "array-contains":
      return Array.isArray(candidate)
        ? candidate.some((entry) => JSON.stringify(entry) === JSON.stringify(expected))
        : false;
    case "array-contains-any":
      return Array.isArray(candidate) && Array.isArray(expected)
        ? candidate.some((entry) => expected.some((item) => JSON.stringify(item) === JSON.stringify(entry)))
        : false;
    default:
      return false;
  }
};

const applyClientConstraints = (rows: Row[], constraints: QueryConstraint[]): Row[] => {
  let result = [...rows];

  const whereConstraints = constraints.filter((c): c is QueryWhereConstraint => c.type === "where");
  for (const constraint of whereConstraints) {
    result = result.filter((row) => valueMatchesWhere(row[constraint.field], constraint.op, constraint.value));
  }

  const orderConstraints = constraints.filter((c): c is QueryOrderConstraint => c.type === "orderBy");
  if (orderConstraints.length) {
    result.sort((left, right) => {
      for (const order of orderConstraints) {
        const comparison = compareValues(left[order.field], right[order.field]);
        if (comparison !== 0) {
          return order.direction === "desc" ? -comparison : comparison;
        }
      }
      return 0;
    });
  }

  const startAfterConstraint = constraints.find(
    (c): c is QueryStartAfterConstraint => c.type === "startAfter"
  );
  if (startAfterConstraint) {
    const index = result.findIndex((row) => String(row.id ?? row.uid ?? "") === startAfterConstraint.cursorId);
    if (index >= 0) {
      result = result.slice(index + 1);
    }
  }

  const limitConstraint = constraints.find((c): c is QueryLimitConstraint => c.type === "limit");
  if (limitConstraint) {
    result = result.slice(0, Math.max(0, limitConstraint.count));
  }

  return result;
};

const buildCollectionRef = (segments: string[]): CollectionReference => {
  const normalized = normalizeSegments(segments);
  if (normalized.length === 0 || normalized.length % 2 === 0) {
    throw new Error(`Caminho de collection invalido: ${segments.join("/")}`);
  }

  const collectionName = normalized[normalized.length - 1];
  return {
    kind: "collection",
    path: normalized.join("/"),
    segments: normalized,
    table: getTableFromCollectionSegments(normalized),
    collectionName,
    parentDocs: getParentDocs(normalized),
  };
};

const buildDocRef = (segments: string[]): DocumentReference => {
  const normalized = normalizeSegments(segments);
  if (normalized.length < 2 || normalized.length % 2 !== 0) {
    throw new Error(`Caminho de documento invalido: ${segments.join("/")}`);
  }

  const docId = normalized[normalized.length - 1];
  const parent = buildCollectionRef(normalized.slice(0, -1));

  return {
    kind: "document",
    path: normalized.join("/"),
    segments: normalized,
    id: docId,
    parent,
  };
};

const addParentFiltersToBuilder = (
  builder: {
    eq: (column: string, value: unknown) => unknown;
  },
  collectionRef: CollectionReference
): void => {
  for (const parent of collectionRef.parentDocs) {
    builder.eq(getParentForeignKeyColumn(parent.collection), parent.id);
  }
};

const executeQueryRows = async (queryRef: QueryReference): Promise<Row[]> => {
  const supabase = getSupabaseClient();
  const { collection: collectionRef, constraints } = queryRef;

  const limitConstraint = constraints.find((c): c is QueryLimitConstraint => c.type === "limit");
  const limitValue = limitConstraint ? Math.max(1, limitConstraint.count) : 200;

  const runSelect = async (withServerWhereAndOrder: boolean): Promise<{ rows: Row[]; error: unknown | null }> => {
    let builder = supabase.from(collectionRef.table).select("*");

    addParentFiltersToBuilder(builder as unknown as { eq: (column: string, value: unknown) => unknown }, collectionRef);

    if (withServerWhereAndOrder) {
      for (const constraint of constraints) {
        if (constraint.type === "where") {
          switch (constraint.op) {
            case "==":
              builder = builder.eq(constraint.field, constraint.value);
              break;
            case "!=":
              builder = builder.neq(constraint.field, constraint.value);
              break;
            case ">":
              builder = builder.gt(constraint.field, constraint.value as Primitive);
              break;
            case ">=":
              builder = builder.gte(constraint.field, constraint.value as Primitive);
              break;
            case "<":
              builder = builder.lt(constraint.field, constraint.value as Primitive);
              break;
            case "<=":
              builder = builder.lte(constraint.field, constraint.value as Primitive);
              break;
            case "in":
              if (Array.isArray(constraint.value)) {
                builder = builder.in(constraint.field, constraint.value as Primitive[]);
              }
              break;
            case "array-contains":
              builder = builder.contains(constraint.field, [constraint.value]);
              break;
            case "array-contains-any":
              // Sem equivalente direto simples em todas as colunas; filtramos no cliente.
              break;
            default:
              break;
          }
        }

        if (constraint.type === "orderBy") {
          builder = builder.order(constraint.field, { ascending: constraint.direction !== "desc" });
        }
      }
    }

    builder = builder.limit(Math.min(limitValue * 3, 1000));

    const { data, error } = await builder;
    if (error) {
      return { rows: [], error };
    }

    return {
      rows: Array.isArray(data) ? (data as Row[]) : [],
      error: null,
    };
  };

  const primary = await runSelect(true);
  if (!primary.error) {
    return applyClientConstraints(primary.rows, constraints);
  }

  const fallback = await runSelect(false);
  if (fallback.error) {
    throw wrapBackendError(fallback.error, "firestore/query-failed");
  }

  return applyClientConstraints(fallback.rows, constraints);
};

const findExistingRow = async (ref: DocumentReference): Promise<Row | null> => {
  const supabase = getSupabaseClient();
  const candidates = getPrimaryIdCandidates(ref);
  let lastError: unknown = null;
  let hadSuccessfulAttempt = false;

  for (const idColumn of candidates) {
    let builder = supabase.from(ref.parent.table).select("*");
    addParentFiltersToBuilder(builder as unknown as { eq: (column: string, value: unknown) => unknown }, ref.parent);
    builder = builder.eq(idColumn, ref.id).limit(1);

    const { data, error } = await builder;
    if (error) {
      // Coluna candidata ausente (ex.: users tem uid, mas nao id/doc_id) nao deve quebrar leitura.
      if (isMissingColumnError(error)) {
        continue;
      }
      lastError = error;
      continue;
    }
    hadSuccessfulAttempt = true;

    const rows = Array.isArray(data) ? (data as Row[]) : [];
    if (!rows.length) {
      // Para tabelas padrao com chave "id", uma consulta bem-sucedida sem resultado
      // ja e suficiente para considerar "documento inexistente" e evita tentativas em
      // colunas candidatas que nao existem (ex.: uid/doc_id/setting_id).
      if (idColumn === "id" && ref.parent.table !== "users") {
        return null;
      }
      continue;
    }

    const row = rows[0];
    if (row.id === undefined && idColumn !== "id") {
      row.id = ref.id;
    }
    if (row.uid === undefined && idColumn === "uid") {
      row.uid = ref.id;
    }
    return row;
  }

  // Se pelo menos uma consulta executou com sucesso e nao encontrou linha, tratamos como "doc inexistente".
  if (lastError && !hadSuccessfulAttempt) {
    throw wrapBackendError(lastError, "firestore/get-doc-failed");
  }

  return null;
};

const upsertDocumentRow = async (ref: DocumentReference, row: Row): Promise<void> => {
  const supabase = getSupabaseClient();

  const parentMetadata = buildParentMetadata(ref.parent);
  const candidateIdColumns = getPrimaryIdCandidates(ref);
  const primaryIdColumn = candidateIdColumns[0] ?? "id";

  const payload: Row = {
    ...parentMetadata,
    ...normalizeForWrite(row) as Row,
  };

  if (payload.id === undefined && payload.uid === undefined) {
    payload[primaryIdColumn] = ref.id;
    if (primaryIdColumn !== "id" && ref.parent.table !== "users") {
      payload.id = ref.id;
    }
    if (primaryIdColumn !== "uid" && ref.parent.table === "users") {
      payload.uid = ref.id;
    }
  }

  // A tabela users no schema atual usa PK "uid" (sem coluna "id").
  if (ref.parent.table === "users" && "id" in payload) {
    delete payload.id;
  }

  let lastError: unknown = null;
  for (const conflictColumn of candidateIdColumns) {
    const rowWithConflict = { ...payload, [conflictColumn]: ref.id };
    const response = await supabase
      .from(ref.parent.table)
      .upsert(rowWithConflict, { onConflict: conflictColumn });

    if (!response.error) {
      emitPathChange(ref.path);
      return;
    }

    if (!isMissingColumnError(response.error)) {
      lastError = response.error;
    }
  }

  // Fallback final: insert simples (quando nao existe PK/constraint definida como esperado).
  const insertResponse = await supabase.from(ref.parent.table).insert(payload);
  if (insertResponse.error) {
    throw wrapBackendError(insertResponse.error ?? lastError, "firestore/upsert-failed");
  }

  emitPathChange(ref.path);
};

const deleteDocumentRow = async (ref: DocumentReference): Promise<void> => {
  const supabase = getSupabaseClient();
  const idCandidates = getPrimaryIdCandidates(ref);
  let lastError: unknown = null;

  for (const idColumn of idCandidates) {
    let builder = supabase.from(ref.parent.table).delete();
    addParentFiltersToBuilder(builder as unknown as { eq: (column: string, value: unknown) => unknown }, ref.parent);
    builder = builder.eq(idColumn, ref.id);

    const { error } = await builder;
    if (!error) {
      emitPathChange(ref.path);
      return;
    }

    lastError = error;
  }

  if (lastError) {
    throw wrapBackendError(lastError, "firestore/delete-doc-failed");
  }
};

const makeDocSnapshot = <T = unknown>(ref: DocumentReference, row: Row | null): DocumentSnapshot<T> => ({
  id: ref.id,
  ref,
  exists: () => row !== null,
  data: () => (cloneDeep((row ?? {}) as T)),
});

const makeQueryDocSnapshot = <T = Row>(row: Row, ref: DocumentReference): QueryDocumentSnapshot<T> => ({
  id: ref.id,
  ref,
  exists: () => true,
  data: () => cloneDeep(row as T),
});

const wrapBackendError = (error: unknown, fallbackCode: string): Error & { code: string } => {
  if (error instanceof Error) {
    const code = (isObject(error) && typeof error.code === "string") ? String(error.code) : fallbackCode;
    return Object.assign(error, { code });
  }

  const errorObj = isObject(error) ? error : null;
  const detailParts = [
    typeof errorObj?.message === "string" ? errorObj.message : null,
    typeof errorObj?.details === "string" ? errorObj.details : null,
  ].filter((part): part is string => Boolean(part));

  const message = detailParts.length
    ? detailParts.join(" | ")
    : "Operacao de dados falhou.";

  return Object.assign(new Error(message), {
    code: fallbackCode,
    cause: error,
  });
};

const isMissingColumnError = (error: unknown): boolean => {
  if (!isObject(error)) return false;

  const code = typeof error.code === "string" ? error.code : "";
  if (code === "42703") return true; // postgres undefined_column

  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return message.includes("column") && message.includes("does not exist");
};

const inferDocRefFromRow = (collectionRef: CollectionReference, row: Row): DocumentReference => {
  const idValue = String(row.id ?? row.uid ?? crypto.randomUUID());
  return doc(collectionRef, idValue);
};

const asRowInput = (value: WritableInput): Row => {
  if (isObject(value)) {
    return value as Row;
  }

  throw new Error("Dados invalidos para operacao no backend.");
};

export function initializeFirestore(
  _app: unknown,
  options: Record<string, unknown> = {}
): FirestoreInstance {
  return {
    kind: "supa-firestore",
    options,
  };
}

export function collection(
  _dbOrDoc: FirestoreInstance | DocumentReference,
  ...segments: string[]
): CollectionReference {
  if ((_dbOrDoc as DocumentReference).kind === "document") {
    const docRef = _dbOrDoc as DocumentReference;
    return buildCollectionRef([...docRef.segments, ...segments]);
  }

  return buildCollectionRef(segments);
}

export function doc(
  dbOrCollection: FirestoreInstance | CollectionReference,
  ...segments: string[]
): DocumentReference;
export function doc(collectionRef: CollectionReference): DocumentReference;
export function doc(collectionRef: CollectionReference, id: string): DocumentReference;
export function doc(
  dbOrCollection: FirestoreInstance | CollectionReference,
  ...segments: string[]
): DocumentReference {
  if ((dbOrCollection as CollectionReference).kind === "collection") {
    const collectionRef = dbOrCollection as CollectionReference;
    if (segments.length === 0) {
      return buildDocRef([...collectionRef.segments, crypto.randomUUID()]);
    }
    if (segments.length !== 1) {
      throw new Error("doc(collectionRef, id?) aceita zero (auto-id) ou exatamente um id.");
    }
    return buildDocRef([...collectionRef.segments, segments[0]]);
  }

  return buildDocRef(segments);
}

export function query(
  collectionRef: CollectionReference | QueryReference,
  ...constraints: QueryConstraint[]
): QueryReference {
  if ((collectionRef as QueryReference).kind === "query") {
    const previous = collectionRef as QueryReference;
    return {
      kind: "query",
      collection: previous.collection,
      constraints: [...previous.constraints, ...constraints],
    };
  }

  return {
    kind: "query",
    collection: collectionRef as CollectionReference,
    constraints,
  };
}

export function where(field: string, op: string, value: unknown): QueryConstraint {
  return { type: "where", field, op, value };
}

export function orderBy(field: string, direction: "asc" | "desc" = "asc"): QueryConstraint {
  return { type: "orderBy", field, direction };
}

export function limit(count: number): QueryConstraint {
  return { type: "limit", count: Math.max(0, Math.floor(count)) };
}

export function startAfter(snapshot: { id?: string } | DocumentSnapshot): QueryConstraint {
  return {
    type: "startAfter",
    cursorId: String(snapshot.id ?? ""),
  };
}

export function serverTimestamp(): SentinelValue {
  return { __kind: "serverTimestamp" };
}

export function increment(amount: number): SentinelValue {
  return { __kind: "increment", amount };
}

export function arrayUnion(...values: unknown[]): SentinelValue {
  return { __kind: "arrayUnion", values };
}

export function arrayRemove(...values: unknown[]): SentinelValue {
  return { __kind: "arrayRemove", values };
}

export function deleteField(): SentinelValue {
  return { __kind: "deleteField" };
}

export async function getDoc<T = unknown>(ref: DocumentReference): Promise<DocumentSnapshot<T>> {
  const row = await findExistingRow(ref);
  return makeDocSnapshot<T>(ref, row);
}

export async function getDocs<T = Row>(
  input: CollectionReference | QueryReference
): Promise<QuerySnapshot<T>> {
  const queryRef: QueryReference = (input as QueryReference).kind === "query"
    ? (input as QueryReference)
    : { kind: "query", collection: input as CollectionReference, constraints: [] };

  const rows = await executeQueryRows(queryRef);
  const docs = rows.map((row) => {
    const ref = inferDocRefFromRow(queryRef.collection, row);
    return makeQueryDocSnapshot<T>(row, ref);
  });

  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (callback) => {
      docs.forEach(callback);
    },
  };
}

export async function addDoc(collectionRef: CollectionReference, data: WritableInput): Promise<DocumentReference> {
  const rowInput = asRowInput(data);
  const id = String(rowInput.id ?? rowInput.uid ?? crypto.randomUUID());
  const ref = doc(collectionRef, id);
  await upsertDocumentRow(ref, { ...rowInput, id });
  return ref;
}

export async function setDoc(
  ref: DocumentReference,
  data: WritableInput,
  options?: { merge?: boolean }
): Promise<void> {
  const rowInput = asRowInput(data);
  if (options?.merge) {
    const current = await findExistingRow(ref);
    const next = current ? mergeObjects(current, rowInput) : (normalizeForWrite(rowInput) as Row);
    await upsertDocumentRow(ref, next);
    return;
  }

  await upsertDocumentRow(ref, normalizeForWrite(rowInput) as Row);
}

export async function updateDoc(ref: DocumentReference, data: WritableInput): Promise<void> {
  const rowInput = asRowInput(data);
  const current = (await findExistingRow(ref)) ?? {};
  const next = applyPatch(current, rowInput);
  await upsertDocumentRow(ref, next);
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  await deleteDocumentRow(ref);
}

export async function getCountFromServer(
  input: CollectionReference | QueryReference
): Promise<{ data: () => { count: number } }> {
  const queryRef: QueryReference = (input as QueryReference).kind === "query"
    ? (input as QueryReference)
    : { kind: "query", collection: input as CollectionReference, constraints: [] };

  const supabase = getSupabaseClient();
  const countColumn = getCompatTableConfig(queryRef.collection.table).primaryKey;
  let builder = supabase
    .from(queryRef.collection.table)
    .select(countColumn, { head: true, count: "estimated" });
  addParentFiltersToBuilder(builder as unknown as { eq: (column: string, value: unknown) => unknown }, queryRef.collection);

  for (const constraint of queryRef.constraints) {
    if (constraint.type !== "where") continue;
    if (constraint.op === "==") {
      builder = builder.eq(constraint.field, constraint.value);
    }
  }

  const { count, error } = await builder;
  if (error) {
    const rows = await executeQueryRows(queryRef);
    return { data: () => ({ count: rows.length }) };
  }

  return {
    data: () => ({ count: typeof count === "number" ? count : 0 }),
  };
}

class CompatTransaction {
  private readonly queued: Array<() => Promise<void>> = [];

  async get<T = unknown>(ref: DocumentReference): Promise<DocumentSnapshot<T>> {
    return getDoc<T>(ref);
  }

  set(ref: DocumentReference, data: WritableInput, options?: { merge?: boolean }): void {
    this.queued.push(() => setDoc(ref, data, options));
  }

  update(ref: DocumentReference, data: WritableInput): void {
    this.queued.push(() => updateDoc(ref, data));
  }

  delete(ref: DocumentReference): void {
    this.queued.push(() => deleteDoc(ref));
  }

  async commit(): Promise<void> {
    // Nao e transacao real; executa em serie para manter compatibilidade de API.
    for (const op of this.queued) {
      await op();
    }
  }
}

export async function runTransaction<T>(
  _db: FirestoreInstance,
  fn: (tx: CompatTransaction) => Promise<T>
): Promise<T> {
  const tx = new CompatTransaction();
  const result = await fn(tx);
  await tx.commit();
  return result;
}

class CompatBatch {
  private readonly queued: Array<() => Promise<void>> = [];

  set(ref: DocumentReference, data: WritableInput, options?: { merge?: boolean }): void {
    this.queued.push(() => setDoc(ref, data, options));
  }

  update(ref: DocumentReference, data: WritableInput): void {
    this.queued.push(() => updateDoc(ref, data));
  }

  delete(ref: DocumentReference): void {
    this.queued.push(() => deleteDoc(ref));
  }

  async commit(): Promise<void> {
    for (const op of this.queued) {
      await op();
    }
  }
}

export function writeBatch(db: FirestoreInstance): CompatBatch {
  void db;
  return new CompatBatch();
}

export function onSnapshot<T = unknown>(
  target: DocumentReference,
  next: (snapshot: DocumentSnapshot<T>) => void,
  error?: (error: unknown) => void
): () => void;
export function onSnapshot<T = unknown>(
  target: QueryReference | CollectionReference,
  next: (snapshot: QuerySnapshot<T>) => void,
  error?: (error: unknown) => void
): () => void;
export function onSnapshot<T = unknown>(
  target: DocumentReference | QueryReference | CollectionReference,
  next: ((snapshot: DocumentSnapshot<T>) => void) | ((snapshot: QuerySnapshot<T>) => void),
  error?: (error: unknown) => void
): () => void {
  const run = async (): Promise<void> => {
    try {
      if ((target as DocumentReference).kind === "document") {
        const snapshot = await getDoc<T>(target as DocumentReference);
        (next as (snapshot: DocumentSnapshot<T>) => void)(snapshot);
        return;
      }

      const snapshot = await getDocs<T>(target as QueryReference | CollectionReference);
      (next as (snapshot: QuerySnapshot<T>) => void)(snapshot);
    } catch (err: unknown) {
      if (error) {
        error(err);
        return;
      }
      console.error("Erro no onSnapshot compat:", err);
    }
  };

  void run();

  const path = (target as QueryReference).kind === "query"
    ? (target as QueryReference).collection.path
    : (target as CollectionReference | DocumentReference).path;

  return subscribePathChange(path, () => {
    void run();
  });
}

