"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, CheckCircle2, Clock3, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchMyTenantOnboardingRequests,
  submitTenantOnboardingRequest,
  type TenantOnboardingRequest,
  type TenantPaletteKey,
} from "@/lib/tenantService";

const PALETTE_OPTIONS: Array<{ key: TenantPaletteKey; label: string }> = [
  { key: "green", label: "Verde" },
  { key: "yellow", label: "Amarelo" },
  { key: "red", label: "Vermelho" },
  { key: "blue", label: "Azul" },
  { key: "orange", label: "Laranja" },
  { key: "purple", label: "Roxo" },
  { key: "pink", label: "Rosa" },
];

const AREA_OPTIONS = [
  { value: "", label: "Selecione a area" },
  { value: "exatas", label: "Exatas" },
  { value: "humanas", label: "Humanas" },
  { value: "biologicas", label: "Biologicas" },
  { value: "saude", label: "Saude" },
];

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
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

const statusBadgeClass = (status: string): string => {
  if (status === "approved") return "bg-emerald-500/20 border-emerald-500/40 text-emerald-300";
  if (status === "rejected") return "bg-red-500/20 border-red-500/40 text-red-300";
  return "bg-cyan-500/20 border-cyan-500/40 text-cyan-200";
};

export default function NovaAtleticaPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<TenantOnboardingRequest[]>([]);

  const [nome, setNome] = useState("");
  const [sigla, setSigla] = useState("");
  const [faculdade, setFaculdade] = useState("");
  const [cidade, setCidade] = useState("");
  const [curso, setCurso] = useState("");
  const [area, setArea] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [contatoEmail, setContatoEmail] = useState("");
  const [contatoTelefone, setContatoTelefone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [paletteKey, setPaletteKey] = useState<TenantPaletteKey>("green");

  const latestRequest = requests[0] || null;

  const hasApprovedTenant = useMemo(() => {
    const status = String(user?.tenant_status || "").trim().toLowerCase();
    return status === "approved" && typeof user?.tenant_id === "string" && user.tenant_id.trim().length > 0;
  }, [user?.tenant_id, user?.tenant_status]);

  const loadRequests = useCallback(async (mode: "initial" | "refresh"): Promise<void> => {
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    try {
      const rows = await fetchMyTenantOnboardingRequests({ limit: 10 });
      setRequests(rows);
    } catch (error: unknown) {
      addToast(`Erro ao carregar solicitacoes: ${extractErrorMessage(error)}`, "error");
    } finally {
      if (mode === "initial") setLoading(false);
      if (mode === "refresh") setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void loadRequests("initial");
  }, [authLoading, loadRequests, router, user]);

  const handleSubmit = async () => {
    if (!nome.trim()) {
      addToast("Informe o nome da atletica.", "error");
      return;
    }
    if (!sigla.trim()) {
      addToast("Informe a sigla.", "error");
      return;
    }
    if (!faculdade.trim()) {
      addToast("Informe a faculdade.", "error");
      return;
    }
    if (!contatoEmail.trim()) {
      addToast("Informe o email de contato da atletica.", "error");
      return;
    }
    if (!contatoTelefone.trim()) {
      addToast("Informe o telefone de contato da atletica.", "error");
      return;
    }

    try {
      setSubmitting(true);
      await submitTenantOnboardingRequest({
        nome: nome.trim(),
        sigla: sigla.trim().toUpperCase(),
        faculdade: faculdade.trim(),
        cidade: cidade.trim() || undefined,
        curso: curso.trim() || undefined,
        area: area.trim() || undefined,
        cnpj: cnpj.trim() || undefined,
        contatoEmail: contatoEmail.trim() || undefined,
        contatoTelefone: contatoTelefone.trim() || undefined,
        logoUrl: logoUrl.trim() || undefined,
        paletteKey,
      });

      addToast("Solicitacao enviada. Agora aguarde aprovacao do master da plataforma.", "success");
      await loadRequests("refresh");
    } catch (error: unknown) {
      addToast(`Erro ao enviar solicitacao: ${extractErrorMessage(error)}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center text-sm font-black uppercase">
        Carregando onboarding...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-20 font-sans">
      <header className="sticky top-0 z-20 bg-[#050505]/95 backdrop-blur border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight inline-flex items-center gap-2">
                <Building2 size={18} className="text-emerald-400" />
                Onboarding de Atletica
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold uppercase">
                Cadastro inicial para criacao de tenant
              </p>
            </div>
          </div>

          <button
            onClick={() => void loadRequests("refresh")}
            disabled={refreshing}
            className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs font-black uppercase inline-flex items-center gap-2 disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </header>

      <main className="px-6 py-6 max-w-4xl mx-auto space-y-6">
        {hasApprovedTenant && (
          <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <p className="text-sm text-emerald-200 font-bold">
              Seu usuario ja esta vinculado a uma atletica aprovada.
            </p>
          </section>
        )}

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-black uppercase text-cyan-400">Nova Solicitacao</h2>
            <p className="text-[11px] text-zinc-500 font-bold">
              A criacao do tenant passa por aprovacao inicial do master da plataforma.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <input
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              placeholder="Nome da atletica"
              className="bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={sigla}
              onChange={(event) => setSigla(event.target.value)}
              placeholder="Sigla (ex: AAAKN)"
              className="bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={faculdade}
              onChange={(event) => setFaculdade(event.target.value)}
              placeholder="Faculdade"
              className="bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={cidade}
              onChange={(event) => setCidade(event.target.value)}
              placeholder="Cidade"
              className="bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={curso}
              onChange={(event) => setCurso(event.target.value)}
              placeholder="Curso"
              className="bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
            <select
              value={area}
              onChange={(event) => setArea(event.target.value)}
              className="bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            >
              {AREA_OPTIONS.map((option) => (
                <option key={option.value || "default"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              value={cnpj}
              onChange={(event) => setCnpj(event.target.value)}
              placeholder="CNPJ (opcional)"
              className="bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="email"
              value={contatoEmail}
              onChange={(event) => setContatoEmail(event.target.value)}
              placeholder="Email de contato"
              className="bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={contatoTelefone}
              onChange={(event) => setContatoTelefone(event.target.value)}
              placeholder="Telefone de contato"
              className="bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={logoUrl}
              onChange={(event) => setLogoUrl(event.target.value)}
              placeholder="Logo URL (opcional)"
              className="bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-[11px] text-zinc-400 font-bold uppercase">Paleta principal</label>
            <select
              value={paletteKey}
              onChange={(event) => setPaletteKey(event.target.value as TenantPaletteKey)}
              className="mt-1 w-full max-w-xs bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            >
              {PALETTE_OPTIONS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-xs font-black uppercase inline-flex items-center gap-2"
          >
            <Send size={14} />
            {submitting ? "Enviando..." : "Enviar Solicitacao"}
          </button>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Clock3 size={16} className="text-amber-300" />
            <h2 className="text-sm font-black uppercase text-amber-300">Historico de Solicitacoes</h2>
          </div>

          <div className="space-y-2">
            {requests.map((request) => (
              <div key={request.id} className="rounded-xl border border-zinc-800 bg-black/50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-black uppercase text-white">
                      {request.sigla} - {request.nome}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      {request.faculdade} {request.cidade ? `| ${request.cidade}` : ""}
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded-lg border text-[10px] font-black uppercase ${statusBadgeClass(request.status)}`}>
                    {request.status}
                  </span>
                </div>
                {request.status === "rejected" && request.rejectionReason && (
                  <p className="text-[11px] text-red-300 mt-2 inline-flex items-start gap-1">
                    <ShieldAlert size={12} className="mt-[1px]" />
                    {request.rejectionReason}
                  </p>
                )}
                {request.status === "approved" && request.approvedTenantId && (
                  <p className="text-[11px] text-emerald-300 mt-2 inline-flex items-start gap-1">
                    <CheckCircle2 size={12} className="mt-[1px]" />
                    Tenant aprovado com sucesso.
                  </p>
                )}
              </div>
            ))}
          </div>

          {requests.length === 0 && (
            <p className="text-sm text-zinc-400">
              Nenhuma solicitacao encontrada para seu usuario.
            </p>
          )}

          {latestRequest?.status === "pending" && (
            <p className="text-[11px] text-cyan-300 font-bold uppercase">
              Existe solicitacao pendente. Aguarde aprovacao inicial.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
