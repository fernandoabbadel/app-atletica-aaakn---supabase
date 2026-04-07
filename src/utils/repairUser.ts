import { getSupabaseClient } from "@/lib/supabase";

// Definicao dos valores padrao para referencia (hardcoded para seguranca do script).
const DEFAULT_VALUES = {
  // Gamificacao
  xp: 0,
  xpMultiplier: 1.0,
  level: 1,
  sharkCoins: 0,
  selos: 0,
  patente: "Plancton", // Valor inicial correto
  tier: "bicho",

  // Plano
  plano: "Bicho Solto",
  plano_status: "ativo",
  plano_badge: "Bicho Solto",
  plano_cor: "zinc",
  plano_icon: "ghost",
  desconto_loja: 0,
  nivel_prioridade: 1,

  // Stats completos
  stats: {
    accountCreated: 1,
    loginCount: 1,
    postsCount: 0,
    commentsCount: 0,
    likesGiven: 0,
    hypesGiven: 0,
    arenaWins: 0,
    arenaLosses: 0,
    scansT8: 0, // Importante para o Album
  },
};

const REPAIR_USER_BASE_COLUMNS = [
  "uid",
  "email",
  "role",
  "tenant_status",
  "xp",
  "xpMultiplier",
  "level",
  "sharkCoins",
  "selos",
  "patente",
  "tier",
  "plano",
  "plano_status",
  "plano_badge",
  "plano_cor",
  "plano_icon",
  "data_adesao",
  "stats",
];

const REPAIR_USER_OPTIONAL_COLUMNS = ["desconto_loja", "nivel_prioridade"];

const extractMissingUsersColumn = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null) return null;

  const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
  const combined = [raw.message, raw.details, raw.hint]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .join(" ");

  const match = combined.match(/'([^']+)' column of 'users'/i);
  if (match?.[1]) return match[1].trim();

  const fallbackMatch = combined.match(/column\s+["']?([^"'\s]+)["']?\s+does not exist/i);
  return fallbackMatch?.[1]?.trim() || null;
};

type RepairUserRow = {
  uid?: string;
  email?: string;
  role?: string;
  tenant_status?: string;
  xp?: number;
  xpMultiplier?: number;
  level?: number;
  sharkCoins?: number;
  selos?: number;
  patente?: string;
  tier?: string;
  plano?: string;
  plano_status?: string;
  plano_badge?: string;
  plano_cor?: string;
  plano_icon?: string;
  desconto_loja?: number;
  nivel_prioridade?: number;
  data_adesao?: string;
  stats?: unknown;
};

const fetchRepairUserRow = async (
  uid: string
): Promise<{ row: RepairUserRow | null; selectedColumns: Set<string> }> => {
  const supabase = getSupabaseClient();
  let columns = [...REPAIR_USER_BASE_COLUMNS, ...REPAIR_USER_OPTIONAL_COLUMNS];

  while (columns.length > 0) {
    const { data, error } = await supabase
      .from("users")
      .select(columns.join(","))
      .eq("uid", uid)
      .maybeSingle();

    if (!error) {
      return {
        row: (data as RepairUserRow | null) ?? null,
        selectedColumns: new Set(columns.map((column) => column.toLowerCase())),
      };
    }

    const missingColumn = extractMissingUsersColumn(error);
    if (!missingColumn) throw error;

    const nextColumns = columns.filter(
      (column) => column.toLowerCase() !== missingColumn.toLowerCase()
    );
    if (nextColumns.length === columns.length) throw error;
    columns = nextColumns;
  }

  return { row: null, selectedColumns: new Set() };
};

export const repairUserProfile = async (uid: string) => {
  const cleanUid = uid.trim();
  if (!cleanUid) return false;

  try {
    const supabase = getSupabaseClient();
    const { row: currentData, selectedColumns } = await fetchRepairUserRow(cleanUid);

    if (!currentData) {
      console.log(`Perfil ${cleanUid} nao encontrado.`);
      return false;
    }

    const updates: Record<string, unknown> = {};
    const roleNormalized = String(currentData.role || "").trim().toLowerCase();
    const tenantStatusNormalized = String(currentData.tenant_status || "").trim().toLowerCase();
    const planNormalized = String(currentData.plano || "").trim().toLowerCase();
    const shouldRepairApprovedVisitorPlan =
      (
        tenantStatusNormalized === "approved" ||
        (roleNormalized !== "" && roleNormalized !== "guest" && roleNormalized !== "visitante")
      ) &&
      (planNormalized === "" || planNormalized === "visitante");

    console.log(`Diagnosticando paciente: ${String(currentData.email || cleanUid)}...`);

    // 1. Verificacao de gamificacao e nivel
    if (currentData.xp === undefined) updates.xp = DEFAULT_VALUES.xp;
    if (currentData.level === undefined) updates.level = DEFAULT_VALUES.level;
    if (currentData.sharkCoins === undefined) updates.sharkCoins = DEFAULT_VALUES.sharkCoins;
    if (currentData.selos === undefined) updates.selos = DEFAULT_VALUES.selos;
    if (currentData.xpMultiplier === undefined) updates.xpMultiplier = DEFAULT_VALUES.xpMultiplier;

    // Importante: patente e tier
    if (!currentData.patente) updates.patente = DEFAULT_VALUES.patente;
    if (!currentData.tier) updates.tier = DEFAULT_VALUES.tier;

    // 2. Verificacao de plano e visual
    if (shouldRepairApprovedVisitorPlan) {
      updates.plano = DEFAULT_VALUES.plano;
      updates.plano_status = DEFAULT_VALUES.plano_status;
      updates.plano_badge = DEFAULT_VALUES.plano_badge;
      updates.plano_cor = DEFAULT_VALUES.plano_cor;
      updates.plano_icon = DEFAULT_VALUES.plano_icon;
      updates.tier = DEFAULT_VALUES.tier;
      if (selectedColumns.has("desconto_loja")) {
        updates.desconto_loja = DEFAULT_VALUES.desconto_loja;
      }
      if (selectedColumns.has("nivel_prioridade")) {
        updates.nivel_prioridade = DEFAULT_VALUES.nivel_prioridade;
      }
      if (currentData.xpMultiplier === undefined || currentData.xpMultiplier <= 0) {
        updates.xpMultiplier = DEFAULT_VALUES.xpMultiplier;
      }
    } else {
      if (!currentData.plano) updates.plano = DEFAULT_VALUES.plano;
      if (!currentData.plano_status) updates.plano_status = DEFAULT_VALUES.plano_status;
      if (!currentData.plano_badge) updates.plano_badge = DEFAULT_VALUES.plano_badge;
      if (!currentData.plano_cor) updates.plano_cor = DEFAULT_VALUES.plano_cor;
      if (!currentData.plano_icon) updates.plano_icon = DEFAULT_VALUES.plano_icon;
    }
    if (
      selectedColumns.has("desconto_loja") &&
      currentData.desconto_loja === undefined
    ) {
      updates.desconto_loja = DEFAULT_VALUES.desconto_loja;
    }
    if (
      selectedColumns.has("nivel_prioridade") &&
      currentData.nivel_prioridade === undefined
    ) {
      updates.nivel_prioridade = DEFAULT_VALUES.nivel_prioridade;
    }

    // Data de adesao (se faltar, assume agora)
    if (!currentData.data_adesao) updates.data_adesao = new Date().toISOString();

    // 3. Verificacao profunda de stats (deep merge)
    const currentStats =
      typeof currentData.stats === "object" && currentData.stats !== null
        ? (currentData.stats as Record<string, unknown>)
        : {};
    const newStats = {
      ...DEFAULT_VALUES.stats, // Comeca com todos os defaults
      ...currentStats, // Sobrescreve com o que o usuario ja tem
    };

    // Compara se o objeto de stats mudou (stringify e rapido para objetos pequenos).
    if (JSON.stringify(newStats) !== JSON.stringify(currentStats)) {
      updates.stats = newStats;
    }

    // 4. Aplicacao do patch
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from("users")
        .update({ ...updates, updatedAt: new Date().toISOString() })
        .eq("uid", cleanUid);
      if (updateError) throw updateError;

      console.log(`Perfil ${cleanUid} reparado. Campos corrigidos:`, Object.keys(updates));
      return true;
    }

    console.log(`Perfil ${cleanUid} ja esta 100% saudavel.`);
    return false;
  } catch (error: unknown) {
    console.error("Erro critico ao reparar perfil:", error);
    return false;
  }
};
