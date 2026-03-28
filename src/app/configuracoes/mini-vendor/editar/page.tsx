"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { Loader2, ImagePlus, Save } from "lucide-react";

import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchCurrentMiniVendorProfile,
  type MiniVendorProfile,
  upsertMiniVendorProfile,
} from "@/lib/miniVendorService";
import {
  buildDraftAssetFileName,
  sanitizeStoragePathSegment,
  uploadImage,
  VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
} from "@/lib/upload";
import {
  hasValidPhoneLength,
  normalizePhoneToBrE164,
  PHONE_MAX_LENGTH,
  PIX_BANK_MAX_LENGTH,
  PIX_HOLDER_MAX_LENGTH,
  PIX_KEY_MAX_LENGTH,
} from "@/utils/contactFields";

import {
  EMPTY_VENDOR_FORM,
  getVendorStatusClass,
  getVendorStatusLabel,
  normalizeVendorForm,
  readDraftObject,
  removeDraftObject,
  restoreVendorFormDraft,
  type MiniVendorFormState,
  writeDraftObject,
} from "../_shared";
import { MiniVendorShell } from "../_components/MiniVendorShell";

export default function MiniVendorCompanyEditPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantLogoUrl } = useTenantTheme();

  const [loading, setLoading] = useState(true);
  const [savingVendor, setSavingVendor] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [profile, setProfile] = useState<MiniVendorProfile | null>(null);
  const [vendorForm, setVendorForm] = useState<MiniVendorFormState>(EMPTY_VENDOR_FORM);
  const draftRestoredRef = useRef(false);

  const canUseArea = Boolean(user?.uid) && Boolean(tenantId.trim());
  const vendorDraftKey = useMemo(() => {
    if (!tenantId.trim() || !user?.uid) return "";
    return `mini-vendor:${tenantId}:${user.uid}:vendor-draft`;
  }, [tenantId, user?.uid]);

  const loadPage = useCallback(async (forceRefresh = true) => {
    const cleanTenantId = tenantId.trim();
    const cleanUserId = user?.uid?.trim() || "";
    if (!cleanTenantId || !cleanUserId) {
      setProfile(null);
      setVendorForm(EMPTY_VENDOR_FORM);
      return;
    }

    const vendorProfile = await fetchCurrentMiniVendorProfile({
      tenantId: cleanTenantId,
      userId: cleanUserId,
      forceRefresh,
    });
    setProfile(vendorProfile);
    setVendorForm(normalizeVendorForm(vendorProfile));
  }, [tenantId, user?.uid]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await loadPage(false);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar cadastro do mini vendor.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [addToast, loadPage]);

  useEffect(() => {
    draftRestoredRef.current = false;
  }, [vendorDraftKey]);

  useEffect(() => {
    if (loading || !vendorDraftKey || draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    const draft = readDraftObject(vendorDraftKey);
    if (!draft) return;
    setVendorForm(restoreVendorFormDraft(draft));
  }, [loading, vendorDraftKey]);

  useEffect(() => {
    if (loading || !vendorDraftKey) return;
    writeDraftObject(vendorDraftKey, vendorForm);
  }, [loading, vendorDraftKey, vendorForm]);

  const handleUploadVendorImage = async (
    event: ChangeEvent<HTMLInputElement>,
    target: "logoUrl" | "coverUrl"
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      if (target === "logoUrl") setUploadingLogo(true);
      else setUploadingCover(true);

      const cleanTenantId = tenantId.trim();
      const cleanUserId = user?.uid?.trim() || "";
      const isStableTarget = cleanTenantId.length > 0 && cleanUserId.length > 0;
      const folder = target === "logoUrl" ? "logos" : "covers";
      const objectDir = isStableTarget
        ? `mini-vendors/${sanitizeStoragePathSegment(cleanTenantId)}/${sanitizeStoragePathSegment(cleanUserId)}/${folder}`
        : `mini-vendors/drafts/${folder}`;
      const fileName = isStableTarget
        ? target === "logoUrl"
          ? "logo"
          : "cover"
        : buildDraftAssetFileName(target === "logoUrl" ? "logo" : "cover");

      const { url, error } = await uploadImage(
        file,
        objectDir,
        {
          fileName,
          upsert: isStableTarget,
          versionStrategy: isStableTarget ? "file-metadata" : "none",
          cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
          scopeKey: `mini-vendor:profile:${cleanTenantId || "draft"}:${cleanUserId || "anon"}:${target}`,
        }
      );
      if (error || !url) {
        addToast(error || "Erro ao subir imagem da loja.", "error");
        return;
      }

      setVendorForm((previous) => ({ ...previous, [target]: url }));
      addToast(target === "logoUrl" ? "Logo enviada." : "Capa enviada.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao subir imagem da loja.", "error");
    } finally {
      if (target === "logoUrl") setUploadingLogo(false);
      else setUploadingCover(false);
    }
  };

  const handleSaveVendor = async () => {
    const cleanTenantId = tenantId.trim();
    const cleanUserId = user?.uid?.trim() || "";

    if (!cleanUserId || !cleanTenantId) {
      addToast("Abra a area da atletica antes de cadastrar a loja.", "error");
      return;
    }
    if (!vendorForm.storeName.trim()) {
      addToast("Nome da loja obrigatorio.", "error");
      return;
    }
    if (!vendorForm.pixKey.trim() || !vendorForm.pixBank.trim() || !vendorForm.pixHolder.trim()) {
      addToast("Preencha chave PIX, banco e titular.", "error");
      return;
    }
    if (vendorForm.pixWhatsapp.trim() && !hasValidPhoneLength(vendorForm.pixWhatsapp)) {
      addToast("Informe um WhatsApp valido para comprovante.", "error");
      return;
    }
    if (vendorForm.whatsapp.trim() && !hasValidPhoneLength(vendorForm.whatsapp)) {
      addToast("Informe um WhatsApp valido para contato da loja.", "error");
      return;
    }

    try {
      setSavingVendor(true);
      const saved = await upsertMiniVendorProfile({
        tenantId: cleanTenantId,
        userId: cleanUserId,
        storeName: vendorForm.storeName.trim(),
        description: vendorForm.description.trim(),
        logoUrl: vendorForm.logoUrl,
        coverUrl: vendorForm.coverUrl,
        pixKey: vendorForm.pixKey.trim(),
        pixBank: vendorForm.pixBank.trim(),
        pixHolder: vendorForm.pixHolder.trim(),
        pixWhatsapp: vendorForm.pixWhatsapp.trim(),
        instagram: vendorForm.instagram.trim(),
        instagramEnabled: vendorForm.instagramEnabled,
        whatsapp: vendorForm.whatsapp.trim(),
        whatsappEnabled: vendorForm.whatsappEnabled,
        categoryButtonColor: vendorForm.categoryButtonColor,
      });
      setProfile(saved);
      setVendorForm(normalizeVendorForm(saved));
      removeDraftObject(vendorDraftKey);
      addToast(
        saved.status === "approved"
          ? "Loja mini vendor atualizada."
          : "Cadastro salvo. Agora ele aguarda aprovacao do admin.",
        "success"
      );
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar loja mini vendor.", "error");
    } finally {
      setSavingVendor(false);
    }
  };

  const profileLogo = vendorForm.logoUrl || profile?.logoUrl || tenantLogoUrl || "/logo.png";
  const profileCover = vendorForm.coverUrl || profile?.coverUrl || tenantLogoUrl || "/logo.png";
  const storePreviewColor = {
    borderColor: vendorForm.categoryButtonColor,
    backgroundColor: vendorForm.categoryButtonColor,
  };

  return (
    <MiniVendorShell
      title="Editar Empresa"
      subtitle="Dados da lojinha separados do catalogo e dos pedidos para reduzir consultas desnecessarias."
    >
      {!canUseArea ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
          Entre em uma atletica valida para usar a area mini vendor.
        </section>
      ) : loading ? (
        <section className="flex min-h-[240px] items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
          <Loader2 className="animate-spin text-blue-400" />
        </section>
      ) : (
        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-zinc-700 bg-black">
                  <Image src={profileLogo} alt="Logo da loja" fill sizes="64px" className="object-cover" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    Cadastro da Loja
                  </p>
                  <h2 className="mt-1 text-xl font-black uppercase text-white">
                    {vendorForm.storeName || "Sua loja mini vendor"}
                  </h2>
                  <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-emerald-400">
                    Rascunho salvo automaticamente nesta pagina.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase ${getVendorStatusClass(profile?.status)}`}>
                      {getVendorStatusLabel(profile?.status)}
                    </span>
                    <span className="inline-flex rounded-full border border-zinc-700 bg-black/30 px-3 py-1 text-[10px] font-black uppercase text-zinc-400">
                      Categoria publica: {vendorForm.storeName.trim() || profile?.storeName || "Minha Loja"}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleSaveVendor()}
                disabled={savingVendor || uploadingLogo || uploadingCover}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs font-black uppercase text-blue-300 hover:bg-blue-500/20 disabled:opacity-60"
              >
                {savingVendor ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {savingVendor ? "Salvando..." : profile ? "Salvar Loja" : "Enviar Cadastro"}
              </button>
            </div>

            {profile?.status !== "approved" ? (
              <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${getVendorStatusClass(profile?.status)}`}>
                {profile?.status === "rejected"
                  ? "Seu cadastro foi rejeitado. Ajuste os dados e envie novamente para nova analise."
                  : profile?.status === "disabled"
                  ? "Sua loja foi desativada pelo admin. Ajuste os dados ou fale com a atletica."
                  : "Depois de salvar, o cadastro fica aguardando aprovacao do admin da atletica."}
              </div>
            ) : null}

            <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input
                    value={vendorForm.storeName}
                    maxLength={80}
                    onChange={(event) =>
                      setVendorForm((previous) => ({
                        ...previous,
                        storeName: event.target.value.slice(0, 80),
                      }))
                    }
                    placeholder="Nome da loja"
                    className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                  <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5">
                    <span className="text-[10px] font-black uppercase text-zinc-400">Cor</span>
                    <input
                      type="color"
                      value={vendorForm.categoryButtonColor}
                      onChange={(event) =>
                        setVendorForm((previous) => ({
                          ...previous,
                          categoryButtonColor: event.target.value,
                        }))
                      }
                      className="h-8 w-10 rounded border border-zinc-700 bg-transparent"
                    />
                  </div>
                  <textarea
                    value={vendorForm.description}
                    maxLength={1200}
                    onChange={(event) =>
                      setVendorForm((previous) => ({
                        ...previous,
                        description: event.target.value.slice(0, 1200),
                      }))
                    }
                    rows={4}
                    placeholder="Descricao da loja"
                    className="resize-y rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500 md:col-span-2"
                  />
                  <input
                    value={vendorForm.pixKey}
                    maxLength={PIX_KEY_MAX_LENGTH}
                    onChange={(event) =>
                      setVendorForm((previous) => ({
                        ...previous,
                        pixKey: event.target.value.slice(0, PIX_KEY_MAX_LENGTH),
                      }))
                    }
                    placeholder="Chave PIX"
                    className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                  <input
                    value={vendorForm.pixBank}
                    maxLength={PIX_BANK_MAX_LENGTH}
                    onChange={(event) =>
                      setVendorForm((previous) => ({
                        ...previous,
                        pixBank: event.target.value.slice(0, PIX_BANK_MAX_LENGTH),
                      }))
                    }
                    placeholder="Banco"
                    className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                  <input
                    value={vendorForm.pixHolder}
                    maxLength={PIX_HOLDER_MAX_LENGTH}
                    onChange={(event) =>
                      setVendorForm((previous) => ({
                        ...previous,
                        pixHolder: event.target.value.slice(0, PIX_HOLDER_MAX_LENGTH),
                      }))
                    }
                    placeholder="Titular do PIX"
                    className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                  <input
                    value={vendorForm.pixWhatsapp}
                    maxLength={PHONE_MAX_LENGTH}
                    inputMode="tel"
                    onChange={(event) =>
                      setVendorForm((previous) => ({
                        ...previous,
                        pixWhatsapp: normalizePhoneToBrE164(event.target.value),
                      }))
                    }
                    placeholder="WhatsApp para comprovante"
                    className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                  <input
                    value={vendorForm.instagram}
                    maxLength={160}
                    onChange={(event) =>
                      setVendorForm((previous) => ({
                        ...previous,
                        instagram: event.target.value.slice(0, 160),
                      }))
                    }
                    placeholder="Instagram da loja"
                    className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                  <label className="inline-flex items-center justify-between rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm text-zinc-300">
                    Instagram ativo
                    <input
                      type="checkbox"
                      checked={vendorForm.instagramEnabled}
                      onChange={(event) =>
                        setVendorForm((previous) => ({
                          ...previous,
                          instagramEnabled: event.target.checked,
                        }))
                      }
                      className="accent-blue-500"
                    />
                  </label>
                  <input
                    value={vendorForm.whatsapp}
                    maxLength={PHONE_MAX_LENGTH}
                    inputMode="tel"
                    onChange={(event) =>
                      setVendorForm((previous) => ({
                        ...previous,
                        whatsapp: normalizePhoneToBrE164(event.target.value),
                      }))
                    }
                    placeholder="WhatsApp da loja"
                    className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                  <label className="inline-flex items-center justify-between rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm text-zinc-300">
                    WhatsApp ativo
                    <input
                      type="checkbox"
                      checked={vendorForm.whatsappEnabled}
                      onChange={(event) =>
                        setVendorForm((previous) => ({
                          ...previous,
                          whatsappEnabled: event.target.checked,
                        }))
                      }
                      className="accent-blue-500"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-xs font-black uppercase text-white">Logo da Loja</p>
                  <div className="mt-3 relative h-28 overflow-hidden rounded-xl border border-zinc-700 bg-black">
                    <Image src={profileLogo} alt="Logo" fill sizes="320px" className="object-cover" />
                  </div>
                  <label
                    className={`mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black uppercase transition ${
                      uploadingLogo
                        ? "cursor-wait border-zinc-700 bg-zinc-800 text-zinc-400"
                        : "border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
                    }`}
                  >
                    {uploadingLogo ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                    {uploadingLogo ? "Enviando..." : "Upload logo"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => void handleUploadVendorImage(event, "logoUrl")}
                      disabled={uploadingLogo}
                    />
                  </label>
                  <div className="mt-2">
                    <ImageResizeHelpLink label="Diminuir a logo no favicon.io/favicon-converter" />
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-xs font-black uppercase text-white">Capa da Loja</p>
                  <div className="mt-3 relative h-28 overflow-hidden rounded-xl border border-zinc-700 bg-black">
                    <Image src={profileCover} alt="Capa" fill sizes="320px" className="object-cover" />
                  </div>
                  <label
                    className={`mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black uppercase transition ${
                      uploadingCover
                        ? "cursor-wait border-zinc-700 bg-zinc-800 text-zinc-400"
                        : "border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
                    }`}
                  >
                    {uploadingCover ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                    {uploadingCover ? "Enviando..." : "Upload capa"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => void handleUploadVendorImage(event, "coverUrl")}
                      disabled={uploadingCover}
                    />
                  </label>
                  <div className="mt-2">
                    <ImageResizeHelpLink label="Diminuir a capa no favicon.io/favicon-converter" />
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[11px] font-black uppercase text-white">Preview da categoria publica</p>
                  <div className="mt-3 relative h-20 overflow-hidden rounded-xl border border-zinc-700 bg-black">
                    <Image src={profileCover} alt="Preview da capa" fill sizes="320px" className="object-cover opacity-80" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                    <span
                      className="absolute bottom-3 left-3 rounded-full border px-3 py-1 text-[10px] font-black uppercase text-white"
                      style={storePreviewColor}
                    >
                      {vendorForm.storeName.trim() || profile?.storeName || "Minha Loja"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </MiniVendorShell>
  );
}
