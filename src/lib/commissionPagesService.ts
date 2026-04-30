import {
  fetchLeagues,
  isLeagueCategory,
  saveLeagueConfig,
  type LeagueRecord,
} from "./leaguesService";
import type { TurmaConfig } from "./turmasService";

const normalizeTurmaKey = (value: unknown): string =>
  String(value || "").trim().toUpperCase();

const findCommissionForTurma = (
  records: LeagueRecord[],
  turmaId: string
): LeagueRecord | null => {
  const cleanTurmaId = normalizeTurmaKey(turmaId);
  if (!cleanTurmaId) return null;

  return (
    records.find(
      (record) =>
        isLeagueCategory(record, "comissao") &&
        normalizeTurmaKey(record.turmaId) === cleanTurmaId
    ) || null
  );
};

const buildCommissionPayloadFromTurma = (turma: TurmaConfig) => ({
  nome: `Comissão ${turma.nome}`,
  sigla: turma.id,
  descricao: `Página oficial da comissão da ${turma.nome}.`,
  visaoGeral: [
    `Representação da ${turma.nome}.`,
    "Membros oficiais.",
    "Agenda interna e aberta.",
    "Loja da comissão.",
  ].join("\n"),
  foto: turma.capa || turma.logo,
  visivel: true,
  ativa: true,
  status: "approved",
  category: "comissao" as const,
  turmaId: turma.id,
});

export async function ensureCommissionPageForTurma(payload: {
  turma: TurmaConfig;
  tenantId?: string | null;
  actorUserId?: string;
  existingRecords?: LeagueRecord[];
}): Promise<{ created: boolean; id?: string }> {
  const turmaId = normalizeTurmaKey(payload.turma.id);
  if (!turmaId || payload.turma.hidden) {
    return { created: false };
  }

  const records =
    payload.existingRecords ??
    (await fetchLeagues({
      orderByField: "nome",
      orderDirection: "asc",
      maxResults: 180,
      forceRefresh: true,
      tenantId: payload.tenantId,
      category: "comissao",
    }));

  const existing = findCommissionForTurma(records, turmaId);
  if (existing) {
    return { created: false, id: existing.id };
  }

  const result = await saveLeagueConfig({
    actorUserId: payload.actorUserId,
    tenantId: payload.tenantId,
    data: buildCommissionPayloadFromTurma(payload.turma),
  });

  return { created: true, id: result.id };
}

export async function ensureCommissionPagesForTurmas(payload: {
  turmas: TurmaConfig[];
  tenantId?: string | null;
  actorUserId?: string;
}): Promise<{ createdCount: number; createdTurmaIds: string[] }> {
  const visibleTurmas = payload.turmas.filter((turma) => !turma.hidden);
  if (!visibleTurmas.length) {
    return { createdCount: 0, createdTurmaIds: [] };
  }

  const records = await fetchLeagues({
    orderByField: "nome",
    orderDirection: "asc",
    maxResults: 180,
    forceRefresh: true,
    tenantId: payload.tenantId,
    category: "comissao",
  });
  const existingTurmas = new Set(
    records
      .map((record) => normalizeTurmaKey(record.turmaId))
      .filter((turmaId) => turmaId.length > 0)
  );
  const createdTurmaIds: string[] = [];

  for (const turma of visibleTurmas) {
    const turmaId = normalizeTurmaKey(turma.id);
    if (!turmaId || existingTurmas.has(turmaId)) continue;

    const result = await saveLeagueConfig({
      actorUserId: payload.actorUserId,
      tenantId: payload.tenantId,
      data: buildCommissionPayloadFromTurma(turma),
    });

    if (result.id) {
      existingTurmas.add(turmaId);
      createdTurmaIds.push(turmaId);
    }
  }

  return {
    createdCount: createdTurmaIds.length,
    createdTurmaIds,
  };
}
