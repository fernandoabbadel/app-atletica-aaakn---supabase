"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Loader2,
  Save,
  Shield,
  Upload,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { TENANT_AREA_OPTIONS } from "@/constants/tenantAreas";
import { isPlatformMaster } from "@/lib/roles";
import {
  fetchTenantById,
  type TenantPaletteKey,
  updateTenantProfile,
  uploadTenantLogo,
} from "@/lib/tenantService";
import { withTenantSlug } from "@/lib/tenantRouting";

type TenantStatus = "active" | "inactive" | "blocked";

type TenantFormState = {
  nome: string;
  sigla: string;
  faculdade: string;
  curso: string;
  cidade: string;
  area: string;
  cnpj: string;
  contatoEmail: string;
  contatoTelefone: string;
  logoUrl: string;
  paletteKey: TenantPaletteKey;
  visibleInDirectory: boolean;
  allowPublicSignup: boolean;
  status: TenantStatus;
  slug: string;
};

const EMPTY_FORM: TenantFormState = {
  nome: "",
  sigla: "",
  faculdade: "",
  curso: "",
  cidade: "",
  area: "",
  cnpj: "",
  contatoEmail: "",
  contatoTelefone: "",
  logoUrl: "",
  paletteKey: "green",
  visibleInDirectory: true,
  allowPublicSignup: true,
  status: "active",
  slug: "",
};

const PALETTE_OPTIONS: Array<{ value: TenantPaletteKey; label: string }> = [
  { value: "green", label: "Verde" },
  { value: "yellow", label: "Amarelo" },
  { value: "red", label: "Vermelho" },
  { value: "blue", label: "Azul" },
  { value: "orange", label: "Laranja" },
  { value: "purple", label: "Roxo" },
  { value: "pink", label: "Rosa" },
];

const STATUS_OPTIONS: Array<{ value: TenantStatus; label: string }> = [
  { value: "active", label: "Ativo" },
  { value: "inactive", label: "Inativo" },
  { value: "blocked", label: "Bloqueado" },
];

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Nao foi possivel salvar a atletica.";
};

export default function MasterTenantEditPage() {
  const params = useParams<{ tenantId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useToast();

  const tenantId = typeof params?.tenantId === "string" ? params.tenantId.trim() : "";
  const canAccess = isPlatformMaster(user);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [form, setForm] = useState<TenantFormState>(EMPTY_FORM);

  useEffect(() => {
    if (!canAccess || !tenantId) {
      setLoading(false);
      return;
    }

    let mounted = true;
    const loadTenant = async () => {
      try {
        setLoading(true);
        const tenant = await fetchTenantById(tenantId);
        if (!mounted) return;
        if (!tenant) {
          addToast("Atletica nao encontrada para edicao.", "error");
          router.replace("/master");
          return;
        }

        setForm({
          nome: tenant.nome,
          sigla: tenant.sigla,
          faculdade: tenant.faculdade,
          curso: tenant.curso,
          cidade: tenant.cidade,
          area: tenant.area,
          cnpj: tenant.cnpj,
          contatoEmail: tenant.contatoEmail,
          contatoTelefone: tenant.contatoTelefone,
          logoUrl: tenant.logoUrl,
          paletteKey: tenant.paletteKey,
          visibleInDirectory: tenant.visibleInDirectory,
          allowPublicSignup: tenant.allowPublicSignup,
          status: tenant.status,
          slug: tenant.slug,
        });
      } catch (error: unknown) {
        if (!mounted) return;
        addToast(extractErrorMessage(error), "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadTenant();
    return () => {
      mounted = false;
    };
  }, [addToast, canAccess, router, tenantId]);

  const adminHref = useMemo(
    () => (form.slug ? withTenantSlug(form.slug, "/admin") : "/master"),
    [form.slug]
  );
  const appHref = useMemo(
    () => (form.slug ? withTenantSlug(form.slug, "/dashboard") : "/master"),
    [form.slug]
  );

  const handleChange = <K extends keyof TenantFormState>(
    key: K,
    value: TenantFormState[K]
  ) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const handleLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !tenantId || uploadingLogo) {
      input.value = "";
      return;
    }

    try {
      setUploadingLogo(true);
      const url = await uploadTenantLogo({ tenantId, file });
      setForm((previous) => ({ ...previous, logoUrl: url }));
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

  const handleSave = async () => {
    if (!tenantId) return;

    try {
      setSaving(true);
      await updateTenantProfile({
        tenantId,
        nome: form.nome,
        sigla: form.sigla,
        faculdade: form.faculdade,
        curso: form.curso,
        cidade: form.cidade,
        area: form.area,
        cnpj: form.cnpj,
        contatoEmail: form.contatoEmail,
        contatoTelefone: form.contatoTelefone,
        logoUrl: form.logoUrl,
        paletteKey: form.paletteKey,
        visibleInDirectory: form.visibleInDirectory,
        allowPublicSignup: form.allowPublicSignup,
        status: form.status,
      });
      addToast(`Atletica ${form.sigla || form.nome} atualizada.`, "success");
      router.refresh();
    } catch (error: unknown) {
      addToast(extractErrorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  };

  if (!canAccess) return null;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-red-300">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <header className="mb-8 rounded-[2rem] border border-red-500/15 bg-[linear-gradient(135deg,rgba(127,29,29,0.22),rgba(10,10,10,0.94)_52%,rgba(127,29,29,0.12))] p-6 shadow-[0_24px_70px_rgba(127,29,29,0.18)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/master"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-black/35 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:bg-zinc-900"
            >
              <ArrowLeft size={14} />
              Voltar ao master
            </Link>
            <p className="mt-4 text-[10px] font-black uppercase tracking-[0.28em] text-red-200">
              Atletica em edicao
            </p>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-black uppercase tracking-tight text-white">
              <Building2 className="text-red-300" /> {form.sigla || form.nome || "Atletica"}
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-zinc-300">
              Ajuste os dados principais da atletica, troque a paleta, controle a aparicao na
              vitrine publica e defina se a entrada fica por convite ou com cadastro aberto para
              aprovacao.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={adminHref}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:bg-zinc-800"
            >
              <Shield size={14} />
              Abrir admin
            </Link>
            <Link
              href={appHref}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:bg-zinc-800"
            >
              <ExternalLink size={14} />
              Abrir app
            </Link>
          </div>
        </div>
      </header>

      <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                Nome
              </label>
              <input
                value={form.nome}
                onChange={(event) => handleChange("nome", event.target.value)}
                className="mt-2 brand-input"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Sigla
                </label>
                <input
                  value={form.sigla}
                  onChange={(event) => handleChange("sigla", event.target.value)}
                  className="mt-2 brand-input"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Slug
                </label>
                <input value={form.slug} readOnly className="mt-2 brand-input text-zinc-500" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Faculdade
                </label>
                <input
                  value={form.faculdade}
                  onChange={(event) => handleChange("faculdade", event.target.value)}
                  className="mt-2 brand-input"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Curso
                </label>
                <input
                  value={form.curso}
                  onChange={(event) => handleChange("curso", event.target.value)}
                  className="mt-2 brand-input"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Cidade
                </label>
                <input
                  value={form.cidade}
                  onChange={(event) => handleChange("cidade", event.target.value)}
                  className="mt-2 brand-input"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Area
                </label>
                <select
                  value={form.area}
                  onChange={(event) => handleChange("area", event.target.value)}
                  className="mt-2 brand-input"
                >
                  <option value="" className="bg-zinc-950 text-white">
                    Selecione a area
                  </option>
                  {TENANT_AREA_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      className="bg-zinc-950 text-white"
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  CNPJ
                </label>
                <input
                  value={form.cnpj}
                  onChange={(event) => handleChange("cnpj", event.target.value)}
                  className="mt-2 brand-input"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                Logo da atletica
              </label>
              <div className="mt-2 flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-black/35 p-4">
                <div className="flex items-center gap-4">
                  <div className="relative h-24 w-24 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950">
                    <Image
                      src={form.logoUrl || "/logo.png"}
                      alt={`Logo ${form.sigla || form.nome || "atletica"}`}
                      fill
                      sizes="96px"
                      className="object-cover"
                      unoptimized={(form.logoUrl || "").startsWith("http")}
                    />
                  </div>

                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-red-100 transition hover:bg-red-500/20">
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
                <p className="text-[11px] text-zinc-500">
                  PNG, JPG ou WEBP at&eacute; 2MB. A imagem &eacute; comprimida automaticamente
                  para manter o projeto leve no plano free.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Contato E-mail
                </label>
                <input
                  value={form.contatoEmail}
                  onChange={(event) => handleChange("contatoEmail", event.target.value)}
                  className="mt-2 brand-input"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Contato Telefone
                </label>
                <input
                  value={form.contatoTelefone}
                  onChange={(event) => handleChange("contatoTelefone", event.target.value)}
                  className="mt-2 brand-input"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Paleta
                </label>
                <select
                  value={form.paletteKey}
                  onChange={(event) =>
                    handleChange("paletteKey", event.target.value as TenantPaletteKey)
                  }
                  className="mt-2 brand-input"
                >
                  {PALETTE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-zinc-950 text-white">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(event) => handleChange("status", event.target.value as TenantStatus)}
                  className="mt-2 brand-input"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-zinc-950 text-white">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3">
                <input
                  type="checkbox"
                  checked={form.allowPublicSignup}
                  onChange={(event) => handleChange("allowPublicSignup", event.target.checked)}
                  className="accent-red-500"
                />
                <div>
                  <span className="block text-sm font-bold text-zinc-200">
                    Liberar cadastro sem convite
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    Desmarcado: a entrada fica somente por convite.
                  </span>
                </div>
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3">
                <input
                  type="checkbox"
                  checked={form.visibleInDirectory}
                  onChange={(event) => handleChange("visibleInDirectory", event.target.checked)}
                  className="accent-red-500"
                />
                <div>
                  <span className="block text-sm font-bold text-zinc-200">
                    Exibir na pagina visitante
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    Desmarcado: a atlética sai da vitrine, mas o link direto continua funcionando.
                  </span>
                </div>
              </label>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Salvando atletica..." : "Salvar atletica"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
