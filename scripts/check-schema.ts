import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type ExpectedSchema = Record<string, readonly string[]>;

const EXPECTED_SCHEMA: ExpectedSchema = {
  users: ["uid", "nome", "foto", "role", "xp", "createdAt", "updatedAt"],
  settings: ["id", "data", "createdAt", "updatedAt"],
  notifications: ["id", "userId", "title", "message", "read", "createdAt"],
  activity_logs: ["id", "userId", "userName", "action", "resource", "details", "timestamp"],

  ligas_config: [
    "id",
    "nome",
    "sigla",
    "presidente",
    "descricao",
    "senha",
    "foto",
    "ativa",
    "visivel",
    "membros",
    "eventos",
    "perguntas",
    "bizu",
    "likes",
  ],
  eventos: [
    "id",
    "titulo",
    "data",
    "hora",
    "local",
    "status",
    "createdAt",
    "categoria",
    "criadorId",
    "criadorNome",
  ],
  eventos_enquetes: ["id", "eventoId", "question", "options", "voters", "createdAt"],
  eventos_rsvps: ["id", "eventoId", "userId"],

  parceiros: ["id", "nome", "status", "imgLogo", "imgCapa", "totalScans"],
  scans: ["id", "empresaId", "userId", "timestamp"],
  produtos: [
    "id",
    "nome",
    "categoria",
    "descricao",
    "img",
    "preco",
    "estoque",
    "cores",
    "active",
    "aprovado",
    "vendidos",
    "createdAt",
    "updatedAt",
  ],
  orders: [
    "id",
    "userId",
    "userName",
    "productId",
    "productName",
    "price",
    "quantidade",
    "itens",
    "total",
    "data",
    "status",
    "approvedBy",
    "createdAt",
    "updatedAt",
  ],
  reviews: ["id", "userId", "productId"],
  store_rewards: ["id", "title", "cost", "stock", "active"],
  store_redemptions: ["id", "userId", "rewardId", "status", "createdAt"],

  posts: ["id", "userId", "userName", "createdAt"],
  denuncias: ["id"],
  treinos: ["id", "modalidade"],
  treinos_rsvps: ["id", "treinoId", "userId"],
  treinos_chamada: ["id", "treinoId"],

  planos: ["id", "nome"],
  solicitacoes_adesao: ["id"],
  solicitacoes_ingressos: ["id"],
  achievements_logs: ["id", "userId", "timestamp"],
  legal_docs: ["id", "data", "updatedAt"],
  support_requests: ["id", "status", "createdAt"],
  banned_appeals: ["id", "status", "createdAt"],
  album_config: ["id"],
  album_rankings: ["id"],
  album_summary: ["userId"],
  guia_data: ["id"],
  historic_events: ["id"],
};

const ENV_FILES = [".env.local", ".env"];

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadLocalEnv(): Record<string, string> {
  const root = process.cwd();
  const merged: Record<string, string> = {};

  for (const envFile of ENV_FILES) {
    const fullPath = path.join(root, envFile);
    if (!existsSync(fullPath)) continue;
    Object.assign(merged, parseEnvFile(readFileSync(fullPath, "utf8")));
  }

  return merged;
}

function toDefinedValues(values: Array<string | undefined>): string[] {
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function buildSupabaseDirectDbUrl(options: {
  databaseUrl?: string;
  supabaseProjectUrl?: string;
}): string | null {
  if (!options.databaseUrl || !options.supabaseProjectUrl) return null;

  try {
    const dbUrl = new URL(options.databaseUrl);
    const projectUrl = new URL(options.supabaseProjectUrl);
    const projectRef = projectUrl.hostname.split(".")[0];
    if (!projectRef) return null;

    dbUrl.hostname = `db.${projectRef}.supabase.co`;
    dbUrl.port = "5432";
    if (dbUrl.username.startsWith("postgres.")) {
      dbUrl.username = "postgres";
    }
    return dbUrl.toString();
  } catch {
    return null;
  }
}

function buildSupabaseDirectDbUrlVariants(options: {
  databaseUrl?: string;
  supabaseProjectUrl?: string;
}): string[] {
  const base = buildSupabaseDirectDbUrl(options);
  if (!base) return [];

  const variants = [base];
  try {
    const url = new URL(base);
    if (url.username !== "postgres") {
      url.username = "postgres";
      variants.unshift(url.toString());
    }
  } catch {
    // ignore and keep base variant only
  }

  return [...new Set(variants)];
}

function resolveDatabaseUrls(): string[] {
  const localEnv = loadLocalEnv();
  const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    localEnv.DATABASE_URL ||
    localEnv.SUPABASE_DB_URL;
  const directDatabaseUrl =
    process.env.SUPABASE_DB_DIRECT_URL || localEnv.SUPABASE_DB_DIRECT_URL;
  const supabaseProjectUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || localEnv.NEXT_PUBLIC_SUPABASE_URL;

  const derivedDirectUrls = buildSupabaseDirectDbUrlVariants({
    databaseUrl,
    supabaseProjectUrl,
  });

  const candidates = toDefinedValues([
    directDatabaseUrl,
    ...derivedDirectUrls,
    databaseUrl,
  ]);

  if (candidates.length === 0) {
    throw new Error(
      "DATABASE_URL ausente. Defina DATABASE_URL (ou SUPABASE_DB_DIRECT_URL) para rodar scripts/check-schema.ts."
    );
  }

  return [...new Set(candidates)];
}

function resolvePsqlBin(): string {
  const candidates = [
    process.env.PSQL_BIN,
    // Windows common install location
    "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe",
    "psql",
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const bin of candidates) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return bin;
    } catch {
      // try next
    }
  }

  throw new Error(
    "psql nao encontrado. Instale o PostgreSQL client ou defina PSQL_BIN apontando para o psql.exe."
  );
}

function runPsqlQuery(psqlBin: string, databaseUrl: string, sql: string): string {
  const output = execFileSync(
    psqlBin,
    [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", sql],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  return String(output ?? "");
}

function fetchPublicSchemaColumns(psqlBin: string, databaseUrl: string): Map<string, Set<string>> {
  const sql = `
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position;
  `;
  const raw = runPsqlQuery(psqlBin, databaseUrl, sql);
  const byTable = new Map<string, Set<string>>();

  for (const line of raw.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean) continue;
    const [tableName, columnName] = clean.split("\t");
    if (!tableName || !columnName) continue;
    const current = byTable.get(tableName) ?? new Set<string>();
    current.add(columnName);
    byTable.set(tableName, current);
  }

  return byTable;
}

function getSupabaseRestConfig(): { url: string; serviceRoleKey: string } {
  const localEnv = loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || localEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios para o fallback REST do check-schema."
    );
  }

  return { url, serviceRoleKey };
}

function isMissingTableError(errorMessage: string, table: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.startsWith("42p01:") ||
    normalized.includes(`relation "public.${table.toLowerCase()}" does not exist`) ||
    normalized.includes(`could not find the table 'public.${table.toLowerCase()}'`) ||
    normalized.includes("relation does not exist")
  );
}

function isMissingColumnError(errorMessage: string, table: string, column: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.startsWith("42703:") ||
    normalized.includes(`could not find the '${column.toLowerCase()}' column`) ||
    normalized.includes(`column ${table.toLowerCase()}.${column.toLowerCase()} does not exist`) ||
    normalized.includes(`column public.${table.toLowerCase()}.${column.toLowerCase()} does not exist`) ||
    normalized.includes(`column "${column.toLowerCase()}" does not exist`) ||
    normalized.includes("schema cache")
  );
}

type RestProbeResult = {
  ok: boolean;
  status: number;
  errorMessage: string;
  errorCode?: string;
};

async function probeColumnViaRest(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  table: string;
  select: string;
}): Promise<RestProbeResult> {
  const url = new URL(`/rest/v1/${params.table}`, params.supabaseUrl);
  url.searchParams.set("select", params.select);
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: params.serviceRoleKey,
      Authorization: `Bearer ${params.serviceRoleKey}`,
      Prefer: "count=estimated",
    },
  });

  if (response.ok) {
    return { ok: true, status: response.status, errorMessage: "" };
  }

  let errorCode: string | undefined;
  let errorMessage = "";
  try {
    const payload = (await response.json()) as Partial<{
      code: string;
      message: string;
      hint: string;
      details: string;
    }>;
    errorCode = typeof payload.code === "string" ? payload.code : undefined;
    errorMessage = [payload.message, payload.details, payload.hint]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" | ");
  } catch {
    errorMessage = (await response.text()).trim();
  }

  return {
    ok: false,
    status: response.status,
    errorCode,
    errorMessage,
  };
}

async function fetchPublicSchemaColumnsViaRest(): Promise<Map<string, Set<string>>> {
  const { url, serviceRoleKey } = getSupabaseRestConfig();

  const byTable = new Map<string, Set<string>>();

  for (const [table, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
    const detected = new Set<string>();

    for (const column of expectedColumns) {
      const probe = await probeColumnViaRest({
        supabaseUrl: url,
        serviceRoleKey,
        table,
        select: column,
      });

      if (probe.ok) {
        detected.add(column);
        continue;
      }

      const message =
        probe.errorCode && probe.errorMessage
          ? `${probe.errorCode}: ${probe.errorMessage}`
          : probe.errorCode || probe.errorMessage;

      if (isMissingTableError(message, table)) {
        // Mark table as absent and stop probing columns for it.
        detected.clear();
        byTable.delete(table);
        break;
      }

      if (isMissingColumnError(message, table, column)) {
        // Table exists, but this expected column is missing. Continue probing others.
        continue;
      }

      throw new Error(
        `REST probe falhou em public.${table}.${column} (HTTP ${probe.status}): ${message || "erro sem mensagem"}`
      );
    }

    if (detected.size > 0) {
      byTable.set(table, detected);
    } else if (expectedColumns.length === 0) {
      byTable.set(table, detected);
    } else {
      // Try one broad probe to distinguish "table exists but all expected columns faltam" from "table missing".
      const probe = await probeColumnViaRest({
        supabaseUrl: url,
        serviceRoleKey,
        table,
        select: "*",
      });
      if (probe.ok) {
        byTable.set(table, detected);
        continue;
      }

      const message =
        probe.errorCode && probe.errorMessage
          ? `${probe.errorCode}: ${probe.errorMessage}`
          : probe.errorCode || probe.errorMessage;
      if (isMissingTableError(message, table)) {
        byTable.delete(table);
        continue;
      }

      // Any other error (ex.: RLS) with service role should be surfaced.
      throw new Error(
        `REST probe falhou em public.${table} (HTTP ${probe.status}): ${message || "erro sem mensagem"}`
      );
    }
  }

  return byTable;
}

function printSchemaAuditResult(columnsByTable: Map<string, Set<string>>): void {
  const missingTables: string[] = [];
  const missingColumns: Array<{ table: string; columns: string[] }> = [];

  for (const [table, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
    const available = columnsByTable.get(table);
    if (!available) {
      missingTables.push(table);
      continue;
    }

    const missing = expectedColumns.filter((column) => !available.has(column));
    if (missing.length > 0) {
      missingColumns.push({ table, columns: missing });
    }
  }

  console.log(`[check-schema] tabelas auditadas: ${Object.keys(EXPECTED_SCHEMA).length}`);
  console.log(`[check-schema] tabelas encontradas no schema public: ${columnsByTable.size}`);

  if (missingTables.length === 0 && missingColumns.length === 0) {
    console.log("[check-schema] OK: schema compativel com o conjunto critico esperado.");
    console.log("[check-schema] Dica (cache PostgREST): NOTIFY pgrst, 'reload schema';");
    return;
  }

  if (missingTables.length > 0) {
    console.error("\n[check-schema] Tabelas ausentes:");
    for (const table of missingTables) {
      console.error(`- public.${table}`);
    }
  }

  if (missingColumns.length > 0) {
    console.error("\n[check-schema] Colunas ausentes:");
    for (const entry of missingColumns) {
      console.error(`- public.${entry.table}: ${entry.columns.join(", ")}`);
    }
  }

  console.error(
    "\n[check-schema] Sugestao se voce ja criou as colunas no banco mas o erro persiste (cache de schema):"
  );
  console.error("NOTIFY pgrst, 'reload schema';");

  process.exit(1);
}

async function main(): Promise<void> {
  const databaseUrls = resolveDatabaseUrls();
  const psqlBin = resolvePsqlBin();
  let columnsByTable: Map<string, Set<string>> | null = null;
  let lastPsqlError: Error | null = null;

  for (const databaseUrl of databaseUrls) {
    try {
      columnsByTable = fetchPublicSchemaColumns(psqlBin, databaseUrl);
      console.log("[check-schema] validacao via psql (information_schema.columns)");
      break;
    } catch (error: unknown) {
      lastPsqlError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!columnsByTable) {
    console.log(
      `[check-schema] psql indisponivel/sem conectividade. Usando fallback via Supabase REST. Motivo: ${
        lastPsqlError?.message ?? "desconhecido"
      }`
    );
    columnsByTable = await fetchPublicSchemaColumnsViaRest();
    console.log("[check-schema] validacao via Supabase REST (probe de colunas esperadas)");
  }

  printSchemaAuditResult(columnsByTable);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[check-schema] Falha: ${message}`);
  console.error("NOTIFY pgrst, 'reload schema';");
  process.exit(1);
});
