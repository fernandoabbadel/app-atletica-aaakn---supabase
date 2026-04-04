"use client";

import { type ChangeEvent, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Building2, Loader2, Rocket, Save, Upload } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import { TENANT_AREA_OPTIONS } from "@/constants/tenantAreas";
import { fetchFinanceiroConfig, saveFinanceiroConfig } from "@/lib/eventsService";
import { canManageTenant } from "@/lib/roles";
import { clearPublicTenantLookupCache } from "@/lib/publicTenantLookup";
import {
  fetchTenantById,
  type TenantPaletteKey,
  updateTenantProfile,
  uploadTenantLogo,
} from "@/lib/tenantService";
import { withTenantSlug } from "@/lib/tenantRouting";
import {
  EMAIL_MAX_LENGTH,
  hasValidPhoneLength,
  isValidEmail,
  normalizeEmailInput,
  normalizePhoneInput,
  PHONE_MAX_LENGTH,
  PIX_BANK_MAX_LENGTH,
  PIX_HOLDER_MAX_LENGTH,
  PIX_KEY_MAX_LENGTH,
} from "@/utils/contactFields";

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
  slug: string;
};

type FinanceiroFormState = {
  chave: string;
  banco: string;
  titular: string;
  whatsapp: string;
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

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Nao foi possivel salvar a atletica.";
};

export default function AdminAtleticaPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId: activeTenantId, tenantSlug, refreshTenantTheme } = useTenantTheme();

  const canAccess = canManageTenant(user);
  const tenantId = activeTenantId.trim();
  const adminHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin") : "/admin";
  const launchHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin/lancamento") : "/admin/lancamento";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [form, setForm] = useState<TenantFormState>(EMPTY_FORM);
  const [savingFinanceiro, setSavingFinanceiro] = useState(false);
  const [financeiroForm, setFinanceiroForm] = useState<FinanceiroFormState>({
    chave: "",
    banco: "",
    titular: "",
    whatsapp: "",
  });

  useEffect(() => {
    if (!canAccess || !tenantId) {
      setLoading(false);
      return;
    }

    let mounted = true;
    const loadTenant = async () => {
      try {
        const [tenant, financeiro] = await Promise.all([
          fetchTenantById(tenantId),
          fetchFinanceiroConfig({
            forceRefresh: true,
            tenantId,
          }),
        ]);
        if (!mounted) return;
        if (!tenant) {
          addToast("Atletica nao encontrada.", "error");
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
          slug: tenant.slug,
        });
        setFinanceiroForm({
          chave: typeof financeiro?.chave === "string" ? financeiro.chave : "",
          banco: typeof financeiro?.banco === "string" ? financeiro.banco : "",
          titular: typeof financeiro?.titular === "string" ? financeiro.titular : "",
          whatsapp: typeof financeiro?.whatsapp === "string" ? financeiro.whatsapp : "",
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
  }, [addToast, canAccess, tenantId]);

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
      addToast("Logo enviada com sucesso.", "success");
    } catch (error: unknown) {
      addToast(`Erro no upload da logo: ${extractErrorMessage(error)}`, "error");
    } finally {
      setUploadingLogo(false);
      input.value = "";
    }
  };

  const handleSave = async () => {
    if (!tenantId) return;
    if (form.contatoEmail.trim() && !isValidEmail(form.contatoEmail)) {
      addToast("Informe um email de contato valido.", "error");
      return;
    }
    if (form.contatoTelefone.trim() && !hasValidPhoneLength(form.contatoTelefone)) {
      addToast("Informe um telefone valido com DDI e somente numeros.", "error");
      return;
    }

    try {
      setSaving(true);
      await updateTenantProfile({
        tenantId,
        nome: form.nome.trim(),
        sigla: form.sigla.trim().toUpperCase(),
        faculdade: form.faculdade.trim(),
        curso: form.curso.trim(),
        cidade: form.cidade.trim(),
        area: form.area.trim(),
        cnpj: form.cnpj.trim(),
        contatoEmail: form.contatoEmail.trim(),
        contatoTelefone: form.contatoTelefone.trim(),
        logoUrl: form.logoUrl.trim(),
        paletteKey: form.paletteKey,
        visibleInDirectory: form.visibleInDirectory,
        allowPublicSignup: form.allowPublicSignup,
      });

      const publicTenantSlug = (form.slug.trim() || tenantSlug.trim()).toLowerCase();
      if (publicTenantSlug) {
        clearPublicTenantLookupCache(publicTenantSlug);
        try {
          const refreshTenantParams = new URLSearchParams({
            slug: publicTenantSlug,
            refresh: "1",
          });
          const refreshLandingParams = new URLSearchParams({
            tenant: publicTenantSlug,
            refresh: "1",
          });
          await Promise.all([
            fetch(`/api/public/tenants?${refreshTenantParams.toString()}`, {
              cache: "no-store",
            }),
            fetch(`/api/public/landing?${refreshLandingParams.toString()}`, {
              cache: "no-store",
            }),
          ]);
        } catch (refreshError: unknown) {
          console.warn("Falha ao atualizar cache publico da atletica.", refreshError);
        }
      }

      refreshTenantTheme();
      addToast("Dados da atletica atualizados.", "success");
    } catch (error: unknown) {
      addToast(extractErrorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFinanceiro = async () => {
    if (!tenantId) return;
    if (
      !financeiroForm.chave.trim() ||
      !financeiroForm.banco.trim() ||
      !financeiroForm.titular.trim()
    ) {
      addToast("Preencha chave PIX, banco e titular.", "error");
      return;
    }
    if (financeiroForm.whatsapp.trim() && !hasValidPhoneLength(financeiroForm.whatsapp)) {
      addToast("Informe um WhatsApp valido para comprovante.", "error");
      return;
    }

    try {
      setSavingFinanceiro(true);
      await saveFinanceiroConfig(
        {
          chave: financeiroForm.chave.trim(),
          banco: financeiroForm.banco.trim(),
          titular: financeiroForm.titular.trim(),
          whatsapp: financeiroForm.whatsapp.trim(),
        },
        { tenantId }
      );
      addToast("Financeiro da atletica atualizado.", "success");
    } catch (error: unknown) {
      addToast(extractErrorMessage(error), "error");
    } finally {
      setSavingFinanceiro(false);
    }
  };

  if (!canAccess) return null;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-white">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <header className="mb-8 rounded-[2rem] border border-emerald-500/15 bg-[linear-gradient(135deg,rgba(5,150,105,0.18),rgba(10,10,10,0.94)_52%,rgba(16,185,129,0.12))] p-6 shadow-[0_24px_70px_rgba(5,150,105,0.16)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href={adminHref}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-black/35 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:bg-zinc-900"
            >
              <ArrowLeft size={14} />
              Voltar ao admin
            </Link>
            <p className="mt-4 text-[10px] font-black uppercase tracking-[0.28em] text-emerald-200">
              Dados da atletica
            </p>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-black uppercase tracking-tight text-white">
              <Building2 className="text-emerald-300" /> {form.sigla || form.nome || "Atletica"}
            </h1>
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
                  <div className="relative h-20 w-20 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950">
                    <Image
                      src={form.logoUrl || "/logo.png"}
                      alt={`Logo ${form.sigla || form.nome || "atletica"}`}
                      fill
                      sizes="80px"
                      className="object-cover"
                      unoptimized={(form.logoUrl || "").startsWith("http")}
                    />
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-[11px] font-black uppercase text-emerald-200 transition hover:bg-emerald-500/20">
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
                  <ImageResizeHelpLink label="Diminuir a logo no favicon.io/favicon-converter" />
                </div>
                <p className="text-[11px] text-zinc-500">
                  PNG, JPG ou WEBP at&eacute; 2MB. O app reduz automaticamente para economizar
                  storage e egress.
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
                  type="email"
                  maxLength={EMAIL_MAX_LENGTH}
                  onChange={(event) =>
                    handleChange("contatoEmail", normalizeEmailInput(event.target.value))
                  }
                  className="mt-2 brand-input"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Contato Telefone
                </label>
                <input
                  value={form.contatoTelefone}
                  maxLength={PHONE_MAX_LENGTH}
                  inputMode="numeric"
                  onChange={(event) =>
                    handleChange("contatoTelefone", normalizePhoneInput(event.target.value))
                  }
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
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3">
                <input
                  type="checkbox"
                  checked={form.allowPublicSignup}
                  onChange={(event) => handleChange("allowPublicSignup", event.target.checked)}
                  className="accent-emerald-500"
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

              <Link
                href={launchHref}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-cyan-300 transition hover:bg-cyan-500/20"
              >
                <Rocket size={14} />
                Abrir Central de Convites
              </Link>

              <label className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3">
                <input
                  type="checkbox"
                  checked={form.visibleInDirectory}
                  onChange={(event) => handleChange("visibleInDirectory", event.target.checked)}
                  className="accent-emerald-500"
                />
                <div>
                  <span className="block text-sm font-bold text-zinc-200">
                    Exibir na pagina visitante
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    Desmarcado: a atletica sai da vitrine, mas o link direto continua funcionando.
                  </span>
                </div>
              </label>
            </div>

            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Salvando atletica..." : "Salvar atletica"}
            </button>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-[2rem] border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
              Financeiro
            </p>
            <h2 className="mt-2 text-xl font-black uppercase text-white">
              Pix e Comprovante da Atletica
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Esse bloco vira o padrao para loja e eventos, mas cada produto ou evento pode sobrescrever.
            </p>
          </div>
          <button
            onClick={() => void handleSaveFinanceiro()}
            disabled={savingFinanceiro}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
          >
            {savingFinanceiro ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {savingFinanceiro ? "Salvando..." : "Salvar Financeiro"}
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <input
            value={financeiroForm.chave}
            maxLength={PIX_KEY_MAX_LENGTH}
            onChange={(event) =>
              setFinanceiroForm((previous) => ({
                ...previous,
                chave: event.target.value.slice(0, PIX_KEY_MAX_LENGTH),
              }))
            }
            placeholder="Chave PIX"
            className="brand-input"
          />
          <input
            value={financeiroForm.banco}
            maxLength={PIX_BANK_MAX_LENGTH}
            onChange={(event) =>
              setFinanceiroForm((previous) => ({
                ...previous,
                banco: event.target.value.slice(0, PIX_BANK_MAX_LENGTH),
              }))
            }
            placeholder="Banco"
            className="brand-input"
          />
          <input
            value={financeiroForm.titular}
            maxLength={PIX_HOLDER_MAX_LENGTH}
            onChange={(event) =>
              setFinanceiroForm((previous) => ({
                ...previous,
                titular: event.target.value.slice(0, PIX_HOLDER_MAX_LENGTH),
              }))
            }
            placeholder="Titular"
            className="brand-input"
          />
          <input
            value={financeiroForm.whatsapp}
            maxLength={PHONE_MAX_LENGTH}
            inputMode="numeric"
            onChange={(event) =>
              setFinanceiroForm((previous) => ({
                ...previous,
                whatsapp: normalizePhoneInput(event.target.value),
              }))
            }
            placeholder="WhatsApp para comprovante"
            className="brand-input"
          />
        </div>
      </section>
    </div>
  );
}
