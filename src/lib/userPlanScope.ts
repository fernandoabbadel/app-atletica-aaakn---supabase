type UserPlanScopeUser = {
  plano?: unknown;
  plano_badge?: unknown;
  tier?: unknown;
};

type PlanCatalogEntry = {
  id?: unknown;
  nome?: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalizePlanToken = (value: unknown): string =>
  asString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const collectUserPlanScope = (
  user: unknown,
  plans?: PlanCatalogEntry[]
): { userPlanNames: string[]; userPlanIds: string[] } => {
  const source = asRecord(user) as UserPlanScopeUser | null;
  const userPlanNames = Array.from(
    new Set(
      [source?.plano, source?.plano_badge, source?.tier]
        .map((entry) => asString(entry))
        .filter((entry) => entry.length > 0)
    )
  );

  if (!plans || plans.length === 0 || userPlanNames.length === 0) {
    return { userPlanNames, userPlanIds: [] };
  }

  const normalizedNames = userPlanNames.map((entry) => normalizePlanToken(entry));
  const userPlanIds = Array.from(
    new Set(
      plans
        .filter((plan) => {
          const normalizedPlanName = normalizePlanToken(plan.nome);
          return normalizedPlanName.length > 0 && normalizedNames.includes(normalizedPlanName);
        })
        .map((plan) => asString(plan.id))
        .filter((entry) => entry.length > 0)
    )
  );

  return { userPlanNames, userPlanIds };
};
