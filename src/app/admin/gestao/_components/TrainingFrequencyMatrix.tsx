"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Table2 } from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { getSupabaseClient } from "@/lib/supabase";
import { asString, throwSupabaseError, type Row } from "@/lib/supabaseData";
import { withTenantSlug } from "@/lib/tenantRouting";
import { upsertChamadaPresence } from "@/lib/treinosNativeService";

type TreinoRow = Row & {
  id?: unknown;
  modalidade?: unknown;
  dia?: unknown;
  diaSemana?: unknown;
  horario?: unknown;
  local?: unknown;
};

type ChamadaRow = Row & {
  id?: unknown;
  treinoId?: unknown;
  userId?: unknown;
  nome?: unknown;
  avatar?: unknown;
  turma?: unknown;
  origem?: unknown;
  status?: unknown;
};

type RsvpRow = Row & {
  treinoId?: unknown;
  userId?: unknown;
  userName?: unknown;
  userAvatar?: unknown;
  userTurma?: unknown;
  status?: unknown;
};

type MatrixData = {
  treinos: TreinoRow[];
  chamada: ChamadaRow[];
  rsvps: RsvpRow[];
};

type CellStatus = "P" | "F" | "J" | "C";

type MatrixStudent = {
  id: string;
  nome: string;
  avatar: string;
  turma: string;
  cells: Map<string, CellStatus>;
};

const emptyMatrixData: MatrixData = {
  treinos: [],
  chamada: [],
  rsvps: [],
};

const statusLabel: Record<CellStatus, string> = {
  P: "Presente",
  F: "Falta",
  J: "Justificado",
  C: "Confirmado",
};

const statusClass: Record<CellStatus, string> = {
  P: "border-emerald-500/30 bg-emerald-500/20 text-emerald-200",
  F: "border-red-500/30 bg-red-500/20 text-red-200",
  J: "border-amber-500/30 bg-amber-500/20 text-amber-100",
  C: "border-cyan-500/30 bg-cyan-500/15 text-cyan-200",
};

const statusKey = (value: unknown): string => asString(value).trim().toLowerCase();

const statusToChamadaStatus = (status: CellStatus): "presente" | "falta" | "justificado" => {
  if (status === "F") return "falta";
  if (status === "J") return "justificado";
  return "presente";
};

const cellStatusFromChamada = (status: string): CellStatus =>
  status === "falta" ? "F" : status === "justificado" ? "J" : "P";

const csvEscape = (value: unknown): string => `"${asString(value).replace(/"/g, '""')}"`;

const formatShortDate = (value: unknown): string => {
  const raw = asString(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-");
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "Sem data" : parsed.toLocaleDateString("pt-BR");
};

async function queryRows(
  table: string,
  select: string,
  tenantId: string,
  orderColumn: string,
  limit: number
): Promise<Row[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from(table).select(select).order(orderColumn, { ascending: true }).limit(limit);
  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;
  if (error) throwSupabaseError(error);
  return Array.isArray(data) ? (data as unknown as Row[]) : [];
}

async function loadMatrixData(tenantId: string): Promise<MatrixData> {
  const [treinos, chamada, rsvps] = await Promise.all([
    queryRows(
      "treinos",
      "id,modalidade,dia,diaSemana,horario,local,tenant_id",
      tenantId,
      "dia",
      1200
    ),
    queryRows(
      "treinos_chamada",
      "id,treinoId,userId,nome,avatar,turma,status,origem,tenant_id",
      tenantId,
      "timestamp",
      5000
    ),
    queryRows(
      "treinos_rsvps",
      "id,treinoId,userId,userName,userAvatar,userTurma,status,tenant_id",
      tenantId,
      "timestamp",
      5000
    ),
  ]);

  return {
    treinos: treinos as TreinoRow[],
    chamada: chamada as ChamadaRow[],
    rsvps: rsvps as RsvpRow[],
  };
}

export default function TrainingFrequencyMatrix() {
  const { tenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const [data, setData] = useState<MatrixData>(emptyMatrixData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalidade, setModalidade] = useState("todas");
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    void loadMatrixData(tenantId.trim())
      .then((nextData) => {
        if (mounted) setData(nextData);
      })
      .catch((loadError: unknown) => {
        console.error(loadError);
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Erro ao carregar frequência.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  const modalidadeOptions = useMemo(
    () =>
      Array.from(
        new Set(data.treinos.map((treino) => asString(treino.modalidade, "Treino")).filter(Boolean))
      ).sort((left, right) => left.localeCompare(right, "pt-BR")),
    [data.treinos]
  );

  const selectedTreinos = useMemo(
    () =>
      data.treinos
        .filter((treino) => modalidade === "todas" || asString(treino.modalidade, "Treino") === modalidade)
        .sort((left, right) => {
          const dateCompare = asString(left.dia).localeCompare(asString(right.dia));
          if (dateCompare !== 0) return dateCompare;
          return asString(left.horario).localeCompare(asString(right.horario), "pt-BR");
        }),
    [data.treinos, modalidade]
  );

  const matrixRows = useMemo(() => {
    const treinoIds = new Set(selectedTreinos.map((treino) => asString(treino.id)).filter(Boolean));
    const students = new Map<string, MatrixStudent>();

    const ensureStudent = (id: string, nome: string, turma: string, avatar = ""): MatrixStudent => {
      const current = students.get(id);
      if (current) {
        if (!current.nome || current.nome === "Aluno") current.nome = nome || current.nome;
        if (!current.turma || current.turma === "Sem turma") current.turma = turma || current.turma;
        if (!current.avatar && avatar) current.avatar = avatar;
        return current;
      }

      const next: MatrixStudent = {
        id,
        nome: nome || "Aluno",
        avatar,
        turma: turma || "Sem turma",
        cells: new Map<string, CellStatus>(),
      };
      students.set(id, next);
      return next;
    };

    data.rsvps.forEach((row) => {
      const treinoId = asString(row.treinoId);
      const userId = asString(row.userId);
      if (!treinoIds.has(treinoId) || !userId || statusKey(row.status) !== "going") return;
      const student = ensureStudent(
        userId,
        asString(row.userName, "Aluno"),
        asString(row.userTurma, "Sem turma"),
        asString(row.userAvatar)
      );
      student.cells.set(treinoId, "C");
    });

    data.chamada.forEach((row) => {
      const treinoId = asString(row.treinoId);
      const userId = asString(row.userId);
      if (!treinoIds.has(treinoId) || !userId) return;
      const student = ensureStudent(
        userId,
        asString(row.nome, "Aluno"),
        asString(row.turma, "Sem turma"),
        asString(row.avatar)
      );
      const status = statusKey(row.status);
      student.cells.set(treinoId, cellStatusFromChamada(status));
    });

    return Array.from(students.values()).sort((left, right) =>
      left.nome.localeCompare(right.nome, "pt-BR", { sensitivity: "base" })
    );
  }, [data.chamada, data.rsvps, selectedTreinos]);

  const backHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/gestao/treinos")
    : "/admin/gestao/treinos";

  const handleSetStatus = async (
    treinoId: string,
    student: MatrixStudent,
    status: CellStatus
  ) => {
    if (!treinoId || status === "C") return;
    const cellKey = `${student.id}:${treinoId}`;
    setSavingCells((prev) => new Set(prev).add(cellKey));

    try {
      const nextStatus = statusToChamadaStatus(status);
      await upsertChamadaPresence({
        treinoId,
        userId: student.id,
        nome: student.nome,
        turma: student.turma,
        avatar: student.avatar,
        origem: "manual",
        status: nextStatus,
        tenantId,
      });

      setData((prev) => ({
        ...prev,
        chamada: [
          ...prev.chamada.filter(
            (row) => !(asString(row.treinoId) === treinoId && asString(row.userId) === student.id)
          ),
          {
            id: `${treinoId}:${student.id}`,
            treinoId,
            userId: student.id,
            nome: student.nome,
            avatar: student.avatar,
            turma: student.turma,
            origem: "manual",
            status: nextStatus,
            tenant_id: tenantId,
          },
        ],
      }));

      addToast("Frequência atualizada.", "success");
    } catch (saveError: unknown) {
      console.error(saveError);
      addToast("Erro ao atualizar frequência.", "error");
    } finally {
      setSavingCells((prev) => {
        const next = new Set(prev);
        next.delete(cellKey);
        return next;
      });
    }
  };

  const handleExportCsv = () => {
    const header = [
      "Aluno",
      "Turma",
      ...selectedTreinos.map((treino) =>
        `${formatShortDate(treino.dia)} - ${asString(treino.modalidade, "Treino")} - ${asString(
          treino.horario,
          "Sem horário"
        )}`
      ),
    ];
    const rows = matrixRows.map((student) => [
      student.nome,
      student.turma,
      ...selectedTreinos.map((treino) => {
        const status = student.cells.get(asString(treino.id));
        return status ? `${status} - ${statusLabel[status]}` : "";
      }),
    ]);
    const csv = `\ufeff${[header, ...rows].map((row) => row.map(csvEscape).join(";")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `frequencia-treinos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-5 text-white md:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Link href={backHref} className="rounded-lg border border-zinc-800 bg-black p-2 text-zinc-300 hover:text-white">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-300">BI Treinos</p>
              <h1 className="mt-1 text-2xl font-black uppercase text-white">Frequência por Data</h1>
              <p className="mt-1 text-sm font-bold text-zinc-500">
                Alunos nas linhas, treinos nas colunas e presença marcada por célula.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-xs font-black uppercase tracking-wide text-zinc-400">
            <Table2 size={16} className="text-cyan-300" />
            Modelo de planilha
          </div>
        </header>

        <section className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-black/40 p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2 text-[11px] font-black uppercase">
            {Object.entries(statusLabel).map(([status, label]) => (
              <span
                key={status}
                className={`rounded-lg border px-2.5 py-1.5 ${statusClass[status as CellStatus]}`}
              >
                {status} - {label}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={matrixRows.length === 0}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-black uppercase tracking-wide text-emerald-200 transition hover:bg-emerald-500 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={15} />
              Exportar CSV
            </button>
            <select
              value={modalidade}
              onChange={(event) => setModalidade(event.target.value)}
              className="min-h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-white outline-none focus:border-cyan-400"
            >
              <option value="todas">Todas as modalidades</option>
              {modalidadeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </section>

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
            <Loader2 className="animate-spin text-cyan-300" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-5 text-sm font-bold text-red-200">
            {error}
          </div>
        ) : selectedTreinos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center text-sm font-bold text-zinc-500">
            Nenhum treino encontrado para o filtro atual.
          </div>
        ) : (
          <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/70">
            <div className="max-h-[72vh] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
                <thead className="sticky top-0 z-20 bg-zinc-950">
                  <tr>
                    <th className="sticky left-0 z-30 min-w-[260px] border-b border-r border-zinc-800 bg-zinc-950 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                      Aluno
                    </th>
                    {selectedTreinos.map((treino) => (
                      <th
                        key={asString(treino.id)}
                        className="min-w-[132px] border-b border-r border-zinc-800 px-3 py-3 text-center align-top"
                      >
                        <span className="block text-[11px] font-black text-white">{formatShortDate(treino.dia)}</span>
                        <span className="mt-1 block text-[10px] font-bold uppercase text-zinc-500">
                          {asString(treino.horario, "-")}
                        </span>
                        <span className="mt-1 block truncate text-[10px] font-bold text-cyan-300">
                          {asString(treino.modalidade, "Treino")}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((student) => (
                    <tr key={student.id} className="group">
                      <td className="sticky left-0 z-10 border-b border-r border-zinc-800 bg-zinc-950 px-4 py-3">
                        <p className="font-black text-white">{student.nome}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">{student.turma}</p>
                      </td>
                      {selectedTreinos.map((treino) => {
                        const treinoId = asString(treino.id);
                        const status = student.cells.get(treinoId);
                        const cellKey = `${student.id}:${treinoId}`;
                        const saving = savingCells.has(cellKey);
                        return (
                          <td key={`${student.id}:${treinoId}`} className="border-b border-r border-zinc-800 px-3 py-3 text-center">
                            <div className="relative inline-flex min-w-[74px] items-center justify-center">
                              <select
                                aria-label={`Frequência de ${student.nome} em ${formatShortDate(treino.dia)}`}
                                value={status ?? ""}
                                disabled={saving}
                                onChange={(event) => {
                                  const nextStatus = event.target.value as CellStatus | "";
                                  if (!nextStatus || nextStatus === "C") return;
                                  void handleSetStatus(treinoId, student, nextStatus);
                                }}
                                className={`h-9 w-full rounded-lg border bg-black/70 px-2 text-center text-xs font-black outline-none transition focus:border-cyan-300 disabled:cursor-wait disabled:opacity-60 ${
                                  status ? statusClass[status] : "border-zinc-800 text-zinc-500"
                                }`}
                              >
                                <option value="">-</option>
                                <option value="P">P</option>
                                <option value="F">F</option>
                                <option value="J">J</option>
                                {status === "C" && <option value="C">C</option>}
                              </select>
                              {saving && <Loader2 size={13} className="pointer-events-none absolute right-2 animate-spin text-cyan-200" />}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
