import { fetchTenantMembershipDirectory } from "./tenantMembershipDirectory";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { getSupabaseClient } from "./supabase";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

export interface TenantPaymentRecipientOption {
  userId: string;
  name: string;
  turma: string;
  phone: string;
  avatarUrl: string;
}

const DEFAULT_AVATAR_URL = "https://github.com/shadcn.png";
const PAYMENT_RECEIVERS_DOC_ID = "payment_receivers";

const resolveRecipientsTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(String(tenantId || "").trim());

const buildPaymentReceiversConfigId = (tenantId: string): string =>
  buildTenantScopedRowId(resolveRecipientsTenantId(tenantId), PAYMENT_RECEIVERS_DOC_ID) ||
  PAYMENT_RECEIVERS_DOC_ID;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const readRecipientsFromConfigData = (value: unknown): TenantPaymentRecipientOption[] => {
  const data = asRecord(value);
  const rows = Array.isArray(data?.recipients)
    ? data?.recipients
    : Array.isArray(value)
      ? value
      : [];

  return rows
    .map((entry) => normalizeTenantPaymentRecipient(asRecord(entry) || {}))
    .filter((entry): entry is TenantPaymentRecipientOption => entry !== null);
};

export const normalizeTenantPaymentRecipient = (
  value: Partial<TenantPaymentRecipientOption> | null | undefined
): TenantPaymentRecipientOption | null => {
  const userId = String(value?.userId || "").trim();
  const name = String(value?.name || "").trim();
  const turma = String(value?.turma || "").trim();
  const phone = String(value?.phone || "").trim();
  const avatarUrl = String(value?.avatarUrl || "").trim();

  if (!userId && !name && !turma && !phone && !avatarUrl) return null;

  return {
    userId,
    name: name || "Usuario",
    turma: turma || "Sem turma",
    phone,
    avatarUrl: avatarUrl || DEFAULT_AVATAR_URL,
  };
};

export const findTenantPaymentRecipient = (
  recipients: TenantPaymentRecipientOption[],
  userId: string
): TenantPaymentRecipientOption | null => {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return null;
  return recipients.find((entry) => entry.userId === cleanUserId) || null;
};

export async function fetchTenantPaymentRecipients(
  tenantId: string
): Promise<TenantPaymentRecipientOption[]> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) return [];

  const supabase = getSupabaseClient();
  const configId = buildPaymentReceiversConfigId(cleanTenantId);
  const { data, error } = await supabase
    .from("app_config")
    .select("id,data")
    .eq("id", configId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message), {
      code: error.code ?? "db/query-failed",
      cause: error,
    });
  }

  return readRecipientsFromConfigData(asRecord(data)?.data);
}

export async function fetchTenantPaymentReceiverDirectory(
  tenantId: string
): Promise<TenantPaymentRecipientOption[]> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) return [];

  const directory = await fetchTenantMembershipDirectory({
    tenantId: cleanTenantId,
    statuses: ["approved"],
    limit: 400,
  });

  return directory
    .map((entry) =>
      normalizeTenantPaymentRecipient({
        userId: entry.userId,
        name: entry.nome,
        turma: entry.turma,
        phone: entry.telefone,
        avatarUrl: entry.foto,
      })
    )
    .filter((entry): entry is TenantPaymentRecipientOption => entry !== null);
}

export async function saveTenantPaymentRecipients(
  tenantId: string,
  recipients: TenantPaymentRecipientOption[]
): Promise<TenantPaymentRecipientOption[]> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) return [];

  const normalized = recipients
    .map((entry) => normalizeTenantPaymentRecipient(entry))
    .filter((entry): entry is TenantPaymentRecipientOption => entry !== null)
    .filter((entry, index, rows) => {
      const key = entry.userId || `${entry.name}:${entry.phone}`;
      return rows.findIndex((candidate) => (candidate.userId || `${candidate.name}:${candidate.phone}`) === key) === index;
    });

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveRecipientsTenantId(cleanTenantId);
  const { error } = await supabase.from("app_config").upsert(
    {
      id: buildPaymentReceiversConfigId(scopedTenantId),
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      data: {
        recipients: normalized,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    throw Object.assign(new Error(error.message), {
      code: error.code ?? "db/query-failed",
      cause: error,
    });
  }

  return normalized;
}
