"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Building2, CheckCircle2, Clock3, RefreshCw, Send, ShieldAlert, Upload } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { TENANT_AREA_OPTIONS } from "@/constants/tenantAreas";
import {
  createTenantWithMaster,
  fetchPendingMembershipStatusForCurrentUser,
  fetchMyTenantOnboardingRequests,
  submitTenantOnboardingRequest,
  type TenantOnboardingRequest,
  type TenantPaletteKey,
  uploadTenantDraftLogo,
} from "@/lib/tenantService";
import { buildLoginPath } from "@/lib/authRedirect";
import { isPlatformMaster } from "@/lib/roles";

const PALETTE_OPTIONS: Array<{ key: TenantPaletteKey; label: string }> = [
  { key: "green", label: "Verde" },
  { key: "yellow", label: "Amarelo" },
  { key: "red", label: "Vermelho" },
  { key: "blue", label: "Azul" },
  { key: "orange", label: "Laranja" },
  { key: "purple", label: "Roxo" },
  { key: "pink", label: "Rosa" },
];

const PALETTE_PREVIEW: Record<
  TenantPaletteKey,
  { primary: string; accent: string; soft: string; dark: string }
> = {
  green: { primary: "#10b981", accent: "#34d399", soft: "#d1fae5", dark: "#05281f" },
  yellow: { primary: "#f59e0b", accent: "#fbbf24", soft: "#fef3c7", dark: "#2d1904" },
  red: { primary: "#ef4444", accent: "#f87171", soft: "#fee2e2", dark: "#320809" },
  blue: { primary: "#3b82f6", accent: "#60a5fa", soft: "#dbeafe", dark: "#071a38" },
  orange: { primary: "#f97316", accent: "#fb923c", soft: "#ffedd5", dark: "#351406" },
  purple: { primary: "#8b5cf6", accent: "#a78bfa", soft: "#ede9fe", dark: "#1f113f" },
  pink: { primary: "#ec4899", accent: "#f472b6", soft: "#fce7f3", dark: "#351023" },
};

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
  if (status === "approved") return "bg-brand-primary/20 border-brand text-brand-accent";
  if (status === "rejected") return "bg-red-500/20 border-red-500/40 text-red-300";
  return "bg-brand-primary/20 border-brand text-brand-accent";
};

export default function NovaAtleticaPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<TenantOnboardingRequest[]>([]);
  const [existingMembershipStatus, setExistingMembershipStatus] = useState<
    "pending" | "approved" | "disabled" | "rejected" | ""
  >("");

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
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const latestRequest = requests[0] || null;
  const isPlatformMasterUser = isPlatformMaster(user);
  const backHref = isPlatformMasterUser ? "/master/solicitacoes" : "/";
  const palettePreview = PALETTE_PREVIEW[paletteKey];

  const hasApprovedTenant = useMemo(() => {
    const status = String(user?.tenant_status || "").trim().toLowerCase();
    return status === "approved" && typeof user?.tenant_id === "string" && user.tenant_id.trim().length > 0;
  }, [user?.tenant_id, user?.tenant_status]);

  const hasExistingTenantMembership =
    !isPlatformMasterUser &&
    (hasApprovedTenant ||
      existingMembershipStatus === "pending" ||
      existingMembershipStatus === "approved" ||
      existingMembershipStatus === "disabled");

  const loadRequests = useCallback(async (mode: "initial" | "refresh"): Promise<void> => {
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    try {
      const [rows, membership] = await Promise.all([
        fetchMyTenantOnboardingRequests({ limit: 10 }),
        isPlatformMasterUser
          ? Promise.resolve(null)
          : fetchPendingMembershipStatusForCurrentUser(),
      ]);
      setRequests(rows);
      setExistingMembershipStatus(membership?.status || "");
    } catch (error: unknown) {
      addToast(`Erro ao carregar solicitacoes: ${extractErrorMessage(error)}`, "error");
    } finally {
      if (mode === "initial") setLoading(false);
      if (mode === "refresh") setRefreshing(false);
    }
  }, [addToast, isPlatformMasterUser]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.isAnonymous) {
      router.replace(buildLoginPath("/nova-atletica"));
      return;
    }
    void loadRequests("initial");
  }, [authLoading, loadRequests, router, user]);

  const handleLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || uploadingLogo) {
      input.value = "";
      return;
    }

    try {
      setUploadingLogo(true);
      const url = await uploadTenantDraftLogo({
        file,
        scope: isPlatformMasterUser ? "master" : "onboarding",
      });
      setLogoUrl(url);
      addToast(
        "Logo enviada. O app reduz automaticamente para economizar storage e egress.",
        "success"
      );
    } catch (error: unknown) {
      addToast(`Erro no upload da logo: ${extractErrorMessage(error)}`, "error");
    } finally {
      setUploadingLogo(false);
      input.value = "";
    }
  };

  const handleSubmit = async () => {
    if (hasExistingTenantMembership) {
      addToast("Seu usuário já está vinculado a uma atlética. Não é permitido criar outra.", "error");
      return;
    }
    if (!nome.trim()) {
      addToast("Informe o nome da atlética.", "error");
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
      addToast("Informe o email de contato da atlética.", "error");
      return;
    }
    if (!contatoTelefone.trim()) {
      addToast("Informe o telefone de contato da atlética.", "error");
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
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
      };

      if (isPlatformMasterUser) {
        await createTenantWithMaster(payload);
        addToast("Atlética criada e liberada no painel master.", "success");
        router.replace("/master/solicitacoes");
        return;
      }

      await submitTenantOnboardingRequest(payload);
      addToast("Solicitação enviada. Agora aguarde aprovação do master da plataforma.", "success");
      await loadRequests("refresh");
    } catch (error: unknown) {
      addToast(`Erro ao enviar solicitação: ${extractErrorMessage(error)}`, "error");
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
            <Link
              href={backHref}
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight inline-flex items-center gap-2">
                <Building2 size={18} className="text-brand-accent" />
                {isPlatformMasterUser ? "Criar Atlética" : "Onboarding de Atlética"}
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold uppercase">
                {isPlatformMasterUser
                  ? "Fluxo direto do master da plataforma"
                  : "Cadastro inicial para criação de tenant"}
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
        {hasExistingTenantMembership && (
          <section className="rounded-2xl border border-brand bg-brand-primary/10 p-5">
            <p className="text-sm text-brand-accent font-bold">
              Seu usuário já está vinculado a uma atlética e não pode criar outra pelo fluxo público.
            </p>
            <p className="mt-2 text-xs text-zinc-300">
              Status atual do vínculo: {existingMembershipStatus || "aprovado"}.
            </p>
          </section>
        )}

        {isPlatformMasterUser && (
          <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">
              Permissão Elevada
            </p>
            <p className="mt-2 text-sm font-bold text-white">
              Como master da plataforma, você pode criar mais de uma atlética e manter vínculo
              administrativo com varias delas.
            </p>
          </section>
        )}

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-black uppercase text-brand-accent">
              {isPlatformMasterUser ? "Nova Atlética" : "Nova Solicitação"}
            </h2>
            <p className="text-[11px] text-zinc-500 font-bold">
              {isPlatformMasterUser
                ? "Esse fluxo cria a atlética direto no tenant e adiciona ao seu painel master."
                : "A criação do tenant passa por aprovação inicial do master da plataforma."}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <input
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              placeholder="Nome da atlética"
              className="brand-input px-3 py-2"
            />
            <input
              value={sigla}
              onChange={(event) => setSigla(event.target.value)}
              placeholder="Sigla (ex: AAAECO)"
              className="brand-input px-3 py-2"
            />
            <input
              value={faculdade}
              onChange={(event) => setFaculdade(event.target.value)}
              placeholder="Faculdade"
              className="brand-input px-3 py-2"
            />
            <input
              value={cidade}
              onChange={(event) => setCidade(event.target.value)}
              placeholder="Cidade"
              className="brand-input px-3 py-2"
            />
            <input
              value={curso}
              onChange={(event) => setCurso(event.target.value)}
              placeholder="Curso"
              className="brand-input px-3 py-2"
            />
            <select
              value={area}
              onChange={(event) => setArea(event.target.value)}
              className="brand-input px-3 py-2"
            >
              <option value="">Selecione a área</option>
              {TENANT_AREA_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              value={cnpj}
              onChange={(event) => setCnpj(event.target.value)}
              placeholder="CNPJ (opcional)"
              className="brand-input px-3 py-2"
            />
            <input
              type="email"
              value={contatoEmail}
              onChange={(event) => setContatoEmail(event.target.value)}
              placeholder="Email de contato"
              className="brand-input px-3 py-2"
            />
            <input
              value={contatoTelefone}
              onChange={(event) => setContatoTelefone(event.target.value)}
              placeholder="Telefone de contato"
              className="brand-input px-3 py-2"
            />
            <div className="md:col-span-2 rounded-2xl border border-zinc-800 bg-black/30 p-4">
              <p className="text-[11px] font-black uppercase text-zinc-400">Logo da atlética</p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <div className="relative h-20 w-20 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950">
                  <Image
                    src={logoUrl || "/logo.png"}
                    alt={`Logo ${sigla || nome || "atlética"}`}
                    fill
                    sizes="80px"
                    className="object-cover"
                    unoptimized={(logoUrl || "").startsWith("http")}
                  />
                </div>
                <label
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-[11px] font-black uppercase transition hover:brightness-110"
                  style={{
                    borderColor: `${palettePreview.accent}66`,
                    backgroundColor: `${palettePreview.primary}26`,
                    color: palettePreview.soft,
                  }}
                >
                  <Upload size={14} />
                  {uploadingLogo ? "Enviando..." : "Adicionar foto"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={uploadingLogo}
                    onChange={(event) => void handleLogoUpload(event)}
                  />
                </label>
              </div>
              <p className="mt-3 text-[11px] text-zinc-500">
                PNG, JPG ou WEBP at&eacute; 2MB. A logo &eacute; comprimida automaticamente para
                manter o app leve no Supabase.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="inline-flex items-center gap-3 text-[11px] font-bold uppercase text-zinc-400">
              <span
                className="h-3.5 w-3.5 rounded-full border border-white/20"
                style={{ backgroundColor: palettePreview.primary }}
              />
              Paleta principal
            </label>
            <select
              value={paletteKey}
              onChange={(event) => setPaletteKey(event.target.value as TenantPaletteKey)}
              className="brand-input mt-1 max-w-xs px-3 py-2"
            >
              {PALETTE_OPTIONS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>

            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              <div
                className="rounded-2xl border p-4"
                style={{
                  borderColor: `${palettePreview.accent}66`,
                  background: `linear-gradient(135deg, ${palettePreview.primary}22, ${palettePreview.dark})`,
                }}
              >
                <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: palettePreview.soft }}>
                  Preview rapido
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <span
                    className="inline-flex rounded-xl px-3 py-2 text-[10px] font-black uppercase"
                    style={{ backgroundColor: `${palettePreview.primary}26`, color: palettePreview.soft }}
                  >
                    Botao suave
                  </span>
                  <span
                    className="inline-flex rounded-xl px-3 py-2 text-[10px] font-black uppercase"
                    style={{ backgroundColor: palettePreview.primary, color: palettePreview.dark }}
                  >
                    Botao forte
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500">
                A bolinha e os botões abaixo mudam na hora para ajudar a escolher a cor da atlética
                antes de enviar a solicitação.
              </p>
            </div>
          </div>

          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || hasExistingTenantMembership}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 font-black uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              background: `linear-gradient(135deg, ${palettePreview.accent}, ${palettePreview.primary})`,
              color: palettePreview.dark,
              boxShadow: `0 18px 45px ${palettePreview.primary}33`,
            }}
          >
            <Send size={14} />
            {submitting
              ? "Enviando..."
              : hasExistingTenantMembership
                ? "Criacao bloqueada"
              : isPlatformMasterUser
                ? "Criar Atlética Agora"
                : "Enviar Solicitação"}
          </button>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Clock3 size={16} className="text-amber-300" />
            <h2 className="text-sm font-black uppercase text-amber-300">
              Histórico de Solicitações
            </h2>
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
                  <p className="text-[11px] text-brand-accent mt-2 inline-flex items-start gap-1">
                    <CheckCircle2 size={12} className="mt-[1px]" />
                    Tenant aprovado com sucesso.
                  </p>
                )}
              </div>
            ))}
          </div>

          {requests.length === 0 && (
            <p className="text-sm text-zinc-400">
              {isPlatformMasterUser
                ? "Nenhuma solicitação pendente criada por este usuário."
                : "Nenhuma solicitação encontrada para seu usuário."}
            </p>
          )}

          {latestRequest?.status === "pending" && (
            <p className="text-[11px] text-brand-accent font-bold uppercase">
              Existe solicitação pendente. Aguarde aprovação inicial.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
