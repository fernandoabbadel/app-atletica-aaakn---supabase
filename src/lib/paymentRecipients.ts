import { fetchTenantMembershipDirectory } from "./tenantMembershipDirectory";

export interface TenantPaymentRecipientOption {
  userId: string;
  name: string;
  turma: string;
  phone: string;
  avatarUrl: string;
}

const DEFAULT_AVATAR_URL = "https://github.com/shadcn.png";

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
