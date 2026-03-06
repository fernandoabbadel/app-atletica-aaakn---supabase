"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, RefreshCw, Users } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import {
  addTurmaConfig,
  fetchTurmasConfig,
  type TurmaConfig,
} from "@/lib/turmasService";

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message || "Erro inesperado.";
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
    const message = [raw.message, raw.details, raw.hint]
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .filter((entry) => entry.length > 0)
      .join(" | ");
    if (message) return message;
  }
  return "Erro inesperado.";
};

const normalizeTurmaIdInput = (raw: string): string => {
  const normalized = raw.trim().toUpperCase();
  if (!normalized) return "";
  if (/^T\d{1,3}$/.test(normalized)) {
    return `T${String(Number(normalized.slice(1)))}`;
  }

  const digits = normalized.replace(/\D/g, "");
  if (!digits) return "";
  return `T${String(Number(digits))}`;
};

const getSuggestedTurmaId = (turmas: TurmaConfig[]): string => {
  const maxNumber = turmas.reduce((acc, turma) => {
    const parsed = Number(turma.id.replace(/\D/g, ""));
    if (!Number.isFinite(parsed)) return acc;
    return Math.max(acc, parsed);
  }, 8);

  return `T${maxNumber + 1}`;
};

export default function AdminCadastroPage() {
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [turmas, setTurmas] = useState<TurmaConfig[]>([]);
  const [idInput, setIdInput] = useState("T9");
  const [nomeInput, setNomeInput] = useState("");
  const [mascoteInput, setMascoteInput] = useState("");
  const [fraseInput, setFraseInput] = useState("");
  const [capaInput, setCapaInput] = useState("");
  const [logoInput, setLogoInput] = useState("");

  const sortedTurmas = useMemo(
    () =>
      [...turmas].sort((left, right) => {
        const leftN = Number(left.id.replace(/\D/g, ""));
        const rightN = Number(right.id.replace(/\D/g, ""));
        const weightLeft = Number.isFinite(leftN) ? leftN : Number.MAX_SAFE_INTEGER;
        const weightRight = Number.isFinite(rightN) ? rightN : Number.MAX_SAFE_INTEGER;
        if (weightLeft !== weightRight) return weightLeft - weightRight;
        return left.id.localeCompare(right.id, "pt-BR");
      }),
    [turmas]
  );

  const refreshTurmas = async (): Promise<void> => {
    const rows = await fetchTurmasConfig({ forceRefresh: true });
    setTurmas(rows);
    setIdInput((prev) => {
      const normalized = normalizeTurmaIdInput(prev);
      if (normalized) return normalized;
      return getSuggestedTurmaId(rows);
    });
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const rows = await fetchTurmasConfig();
        if (!mounted) return;
        setTurmas(rows);
        setIdInput(getSuggestedTurmaId(rows));
      } catch (error: unknown) {
        if (!mounted) return;
        addToast(`Erro ao carregar turmas: ${extractErrorMessage(error)}`, "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  const handleAddTurma = async () => {
    const normalizedId = normalizeTurmaIdInput(idInput);
    if (!normalizedId) {
      addToast("Informe uma turma valida (ex: T9).", "error");
      return;
    }

    try {
      setSaving(true);
      const next = await addTurmaConfig({
        id: normalizedId,
        nome: nomeInput.trim() || undefined,
        mascote: mascoteInput.trim() || undefined,
        frase: fraseInput.trim() || undefined,
        capa: capaInput.trim() || undefined,
        logo: logoInput.trim() || undefined,
      });

      setTurmas(next);
      setIdInput(getSuggestedTurmaId(next));
      setNomeInput("");
      setMascoteInput("");
      setFraseInput("");
      setCapaInput("");
      setLogoInput("");
      addToast(`Turma ${normalizedId} criada com sucesso.`, "success");
    } catch (error: unknown) {
      addToast(`Erro ao adicionar turma: ${extractErrorMessage(error)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center text-sm font-black uppercase">
        Carregando cadastro...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-20 font-sans">
      <header className="sticky top-0 z-20 bg-[#050505]/95 backdrop-blur border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">
                Cadastro Admin
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold uppercase">
                Turmas do Album
              </p>
            </div>
          </div>

          <button
            onClick={() => void refreshTurmas()}
            className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs font-black uppercase inline-flex items-center gap-2"
          >
            <RefreshCw size={14} />
            Atualizar
          </button>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-black uppercase text-emerald-400">
              Adicionar Turma
            </h2>
            <p className="text-[11px] text-zinc-500 font-bold">
              A turma criada aparece automaticamente em /album e em /admin/album/customizacao.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Codigo</label>
              <input
                value={idInput}
                onChange={(event) => setIdInput(event.target.value)}
                placeholder="T9"
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Nome</label>
              <input
                value={nomeInput}
                onChange={(event) => setNomeInput(event.target.value)}
                placeholder="Turma IX"
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Mascote</label>
              <input
                value={mascoteInput}
                onChange={(event) => setMascoteInput(event.target.value)}
                placeholder="Golfinho"
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Frase</label>
              <input
                value={fraseInput}
                onChange={(event) => setFraseInput(event.target.value)}
                placeholder="Nova geracao"
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Capa (opcional)</label>
              <input
                value={capaInput}
                onChange={(event) => setCapaInput(event.target.value)}
                placeholder="/capa_t9.jpg"
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Logo (opcional)</label>
              <input
                value={logoInput}
                onChange={(event) => setLogoInput(event.target.value)}
                placeholder="/turma9.jpg"
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            onClick={handleAddTurma}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-xs font-black uppercase inline-flex items-center gap-2"
          >
            <Plus size={14} />
            {saving ? "Salvando..." : "Adicionar Turma"}
          </button>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-cyan-400" />
            <h2 className="text-sm font-black uppercase text-cyan-400">Turmas Atuais</h2>
          </div>

          <div className="space-y-2">
            {sortedTurmas.map((turma) => (
              <div
                key={turma.id}
                className="rounded-xl border border-zinc-800 bg-black/50 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-black uppercase text-white">
                      {turma.id} - {turma.nome}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      {turma.mascote} | {turma.frase}
                    </p>
                  </div>
                  <div className="text-[10px] text-zinc-500 font-bold uppercase">
                    /album/{turma.slug}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
