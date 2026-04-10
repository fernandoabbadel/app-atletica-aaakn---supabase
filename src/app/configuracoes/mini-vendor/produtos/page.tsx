"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ImagePlus, Loader2, Pencil, Plus, Save, Tags, Trash2, X } from "lucide-react";

import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchCurrentMiniVendorProfile,
  fetchMiniVendorProducts,
  type MiniVendorProfile,
} from "@/lib/miniVendorService";
import { fetchPlanCatalog, type PlanRecord } from "@/lib/plansPublicService";
import { isAdminLikeRole, resolveEffectiveAccessRole } from "@/lib/roles";
import { upsertStoreProduct } from "@/lib/storeService";
import { withTenantSlug } from "@/lib/tenantRouting";
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
  URL_MAX_LENGTH,
} from "@/utils/contactFields";

import {
  buildPlanScopeRows,
  EMPTY_PRODUCT_FORM,
  getProductStatusClass,
  getVendorStatusClass,
  getVendorStatusLabel,
  mapProductRowToForm,
  newVariant,
  parseIntSafe,
  parseMoney,
  PRODUCT_BADGE_MAX_LENGTH,
  PRODUCT_COLORS_TEXT_MAX_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_FEATURES_TEXT_MAX_LENGTH,
  PRODUCT_LOTE_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_VARIANT_FIELD_MAX_LENGTH,
  readDraftObject,
  removeDraftObject,
  restoreProductFormDraft,
  type ProductFormState,
  type ProductRow,
  type ProductStatus,
  writeDraftObject,
} from "../_shared";
import { MiniVendorShell } from "../_components/MiniVendorShell";

export default function MiniVendorProductsPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantLogoUrl, tenantSlug } = useTenantTheme();

  const [loading, setLoading] = useState(true);
  const [plansLoading, setPlansLoading] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const [profile, setProfile] = useState<MiniVendorProfile | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [planCatalog, setPlanCatalog] = useState<PlanRecord[]>([]);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [isProductOpen, setIsProductOpen] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [productForm, setProductForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const draftRestoredRef = useRef(false);

  const currentUserId = user?.uid?.trim() || "";
  const requestedUserId = String(searchParams.get("userId") || "").trim();
  const canManageOtherMiniVendor = isAdminLikeRole(resolveEffectiveAccessRole(user));
  const managedUserId =
    canManageOtherMiniVendor && requestedUserId ? requestedUserId : currentUserId;
  const isAdminManagingVendor =
    canManageOtherMiniVendor &&
    managedUserId.length > 0 &&
    managedUserId !== currentUserId;
  const canUseArea = Boolean(currentUserId) && Boolean(tenantId.trim());
  const isApproved = profile?.status === "approved";
  const storeName = profile?.storeName.trim() || "Minha Loja";
  const profileLogo = profile?.logoUrl || tenantLogoUrl || "/logo.png";
  const backPath = isAdminManagingVendor
    ? "/admin/mini-vendors/cadastros"
    : "/configuracoes/mini-vendor";
  const editCompanyHref = tenantSlug
    ? withTenantSlug(
        tenantSlug,
        `/configuracoes/mini-vendor/editar${isAdminManagingVendor ? `?userId=${encodeURIComponent(managedUserId)}` : ""}`
      )
    : `/configuracoes/mini-vendor/editar${isAdminManagingVendor ? `?userId=${encodeURIComponent(managedUserId)}` : ""}`;
  const productDraftKey = useMemo(() => {
    if (!tenantId.trim() || !managedUserId) return "";
    return `mini-vendor:${tenantId}:${managedUserId}:product-draft`;
  }, [managedUserId, tenantId]);

  const loadProducts = useCallback(async (sellerId: string, forceRefresh = true) => {
    const rows = await fetchMiniVendorProducts({
      tenantId,
      sellerId,
      forceRefresh,
      maxResults: 100,
    });
    setProducts(rows as ProductRow[]);
  }, [tenantId]);

  const loadPage = useCallback(async (forceRefresh = true) => {
    const cleanTenantId = tenantId.trim();
    const cleanUserId = managedUserId.trim();
    if (!cleanTenantId || !cleanUserId) {
      setProfile(null);
      setProducts([]);
      return;
    }

    const vendorProfile = await fetchCurrentMiniVendorProfile({
      tenantId: cleanTenantId,
      userId: cleanUserId,
      forceRefresh,
    });
    setProfile(vendorProfile);
    if (!vendorProfile?.id) {
      setProducts([]);
      return;
    }
    await loadProducts(vendorProfile.id, forceRefresh);
  }, [loadProducts, managedUserId, tenantId]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await loadPage(false);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar produtos do mini vendor.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [addToast, loadPage]);

  const ensurePlanCatalog = useCallback(async (forceRefresh = false): Promise<PlanRecord[]> => {
    if (planCatalog.length > 0 && !forceRefresh) return planCatalog;
    try {
      setPlansLoading(true);
      const plans = await fetchPlanCatalog({ tenantId, forceRefresh, maxResults: 40 });
      setPlanCatalog(plans);
      return plans;
    } finally {
      setPlansLoading(false);
    }
  }, [planCatalog, tenantId]);

  const resetProductForm = useCallback((plans: PlanRecord[]) => {
    setProductForm({
      ...EMPTY_PRODUCT_FORM,
      variantes: [newVariant()],
      planScopeRows: buildPlanScopeRows(plans),
    });
  }, []);

  useEffect(() => {
    draftRestoredRef.current = false;
  }, [productDraftKey]);

  useEffect(() => {
    if (loading || !productDraftKey || draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    const draft = readDraftObject(productDraftKey);
    if (!draft) return;

    const restoreDraft = async () => {
      try {
        const plans = await ensurePlanCatalog(false);
        const restored = restoreProductFormDraft(draft, plans);
        setEditingProductId(restored.editingProductId);
        setProductForm(restored.form);
        setIsProductOpen(restored.isProductOpen);
        setIsPlanModalOpen(restored.isProductOpen && restored.isPlanModalOpen);
      } catch (error: unknown) {
        console.error(error);
        addToast("Nao foi possivel restaurar o rascunho do produto.", "error");
      }
    };

    void restoreDraft();
  }, [addToast, ensurePlanCatalog, loading, productDraftKey]);

  useEffect(() => {
    if (loading || !productDraftKey) return;
    if (!isProductOpen) {
      removeDraftObject(productDraftKey);
      return;
    }
    writeDraftObject(productDraftKey, {
      editingProductId,
      isProductOpen,
      isPlanModalOpen,
      form: productForm,
    });
  }, [editingProductId, isPlanModalOpen, isProductOpen, loading, productDraftKey, productForm]);

  const openCreateProduct = async () => {
    if (!profile?.id) {
      addToast("Cadastre a loja primeiro para liberar os produtos.", "info");
      return;
    }
    try {
      const plans = await ensurePlanCatalog(false);
      setEditingProductId(null);
      resetProductForm(plans);
      setIsPlanModalOpen(false);
      setIsProductOpen(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao abrir formulario do produto.", "error");
    }
  };

  const openEditProduct = async (row: ProductRow) => {
    if (!profile?.id) {
      addToast("Cadastre a loja primeiro para editar produtos.", "info");
      return;
    }
    try {
      const plans = await ensurePlanCatalog(false);
      setEditingProductId(row.id);
      setProductForm(mapProductRowToForm(row, plans));
      setIsPlanModalOpen(false);
      setIsProductOpen(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao abrir edicao do produto.", "error");
    }
  };

  const closeProductForm = () => {
    if (savingProduct) return;
    setEditingProductId(null);
    setIsProductOpen(false);
    setIsPlanModalOpen(false);
    setProductForm(EMPTY_PRODUCT_FORM);
    removeDraftObject(productDraftKey);
  };

  const handleUploadProductImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setUploadingProductImage(true);
      const cleanTenantId = tenantId.trim();
      const sellerId = profile?.id?.trim() || "";
      const productId = editingProductId?.trim() || "";
      const isStableTarget = cleanTenantId.length > 0 && sellerId.length > 0 && productId.length > 0;
      const objectDir = isStableTarget
        ? `mini-vendors/${sanitizeStoragePathSegment(cleanTenantId)}/${sanitizeStoragePathSegment(sellerId)}/produtos/${sanitizeStoragePathSegment(productId)}`
        : `mini-vendors/${sanitizeStoragePathSegment(cleanTenantId || "draft")}/${sanitizeStoragePathSegment(sellerId || "draft")}/produtos/drafts`;
      const { url, error } = await uploadImage(file, objectDir, {
        fileName: isStableTarget ? "produto" : buildDraftAssetFileName("produto"),
        upsert: isStableTarget,
        versionStrategy: isStableTarget ? "file-metadata" : "none",
        cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
        scopeKey: `mini-vendor:product:${cleanTenantId || "draft"}:${sellerId || "draft"}:${productId || "draft"}`,
      });
      if (error || !url) {
        addToast(error || "Erro ao subir imagem do produto.", "error");
        return;
      }
      setProductForm((previous) => ({ ...previous, img: url }));
      addToast("Imagem do produto enviada.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao subir imagem do produto.", "error");
    } finally {
      setUploadingProductImage(false);
    }
  };

  const handleSaveProduct = async () => {
    const cleanTenantId = tenantId.trim();
    if (!profile?.id || !cleanTenantId) {
      addToast("Cadastre a loja primeiro para salvar produtos.", "error");
      return;
    }

    const nome = productForm.nome.trim();
    const preco = parseMoney(productForm.preco);
    const precoAntigo = productForm.precoAntigo.trim() ? parseMoney(productForm.precoAntigo) : 0;
    const variants = productForm.usarVariantes
      ? productForm.variantes
          .map((variant) => ({
            id: variant.id,
            tamanho: variant.tamanho.trim(),
            cor: variant.cor.trim(),
            estoque: parseIntSafe(variant.estoque),
            vendidos: parseIntSafe(variant.vendidos),
          }))
          .filter((variant) => variant.tamanho || variant.cor)
      : [];

    if (!nome) return void addToast("Nome do produto obrigatorio.", "error");
    if (!Number.isFinite(preco) || preco < 0) return void addToast("Preco invalido.", "error");
    if (productForm.usarVariantes && variants.length === 0) {
      return void addToast("Adicione pelo menos uma variacao.", "error");
    }
    if (
      productForm.payment.enabled &&
      (!productForm.payment.chave.trim() ||
        !productForm.payment.banco.trim() ||
        !productForm.payment.titular.trim())
    ) {
      return void addToast("Preencha chave, banco e titular do pagamento proprio.", "error");
    }
    if (
      productForm.payment.enabled &&
      productForm.payment.whatsapp.trim() &&
      !hasValidPhoneLength(productForm.payment.whatsapp)
    ) {
      return void addToast("Informe um WhatsApp valido para o pagamento proprio.", "error");
    }

    const estoqueTotal = variants.length
      ? variants.reduce((acc, item) => acc + Number(item.estoque || 0), 0)
      : parseIntSafe(productForm.estoque);
    const caracteristicas = productForm.caracteristicasText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const coresText = productForm.coresText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    try {
      setSavingProduct(true);
      const payload: Record<string, unknown> = {
        nome,
        categoria: storeName,
        descricao: productForm.descricao.trim(),
        img: productForm.img.trim() || profile.logoUrl || tenantLogoUrl || "/logo.png",
        preco,
        estoque: estoqueTotal,
        lote: productForm.lote.trim() || "geral",
        variantes: variants,
        cores: coresText,
        caracteristicas,
        status: productForm.status,
        plan_prices: productForm.planScopeRows
          .filter((entry) => entry.price.trim().length > 0)
          .map((entry) => ({
            planId: entry.planId,
            planName: entry.planName,
            price: Number(entry.price.replace(",", ".")),
          }))
          .filter((entry) => Number.isFinite(entry.price) && entry.price >= 0),
        plan_visibility: productForm.planScopeRows.map((entry) => ({
          planId: entry.planId,
          planName: entry.planName,
          visible: entry.visible,
        })),
        payment_config: productForm.payment.enabled
          ? {
              chave: productForm.payment.chave.trim(),
              banco: productForm.payment.banco.trim(),
              titular: productForm.payment.titular.trim(),
              whatsapp: productForm.payment.whatsapp.trim(),
            }
          : null,
        seller_type: "mini_vendor",
        seller_id: profile.id,
        seller_name: profile.storeName,
        seller_logo_url: profile.logoUrl || tenantLogoUrl || "/logo.png",
        updatedAt: new Date().toISOString(),
      };

      if (Number.isFinite(precoAntigo) && precoAntigo > preco) payload.precoAntigo = precoAntigo;
      else if (editingProductId) payload.precoAntigo = 0;

      if (productForm.tagLabel.trim()) {
        payload.tagLabel = productForm.tagLabel.trim();
        payload.tagColor = productForm.tagColor;
        payload.tagEffect = productForm.tagEffect;
      } else if (editingProductId) {
        payload.tagLabel = "";
        payload.tagColor = "zinc";
        payload.tagEffect = "none";
      }

      if (!editingProductId) {
        payload.active = true;
        payload.aprovado = true;
        payload.likes = [];
        payload.vendidos = 0;
        payload.cliques = 0;
      }

      await upsertStoreProduct({
        ...(editingProductId ? { productId: editingProductId } : {}),
        tenantId: cleanTenantId,
        data: payload,
      });

      await loadProducts(profile.id, true);
      closeProductForm();
      addToast(editingProductId ? "Produto atualizado." : "Produto criado.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast(editingProductId ? "Erro ao atualizar produto." : "Erro ao criar produto.", "error");
    } finally {
      setSavingProduct(false);
    }
  };

  const addVariant = () =>
    setProductForm((previous) => ({
      ...previous,
      variantes: [...previous.variantes, newVariant()],
    }));

  const removeVariant = (id: string) =>
    setProductForm((previous) => {
      const next = previous.variantes.filter((variant) => variant.id !== id);
      return {
        ...previous,
        variantes: next.length ? next : [newVariant()],
      };
    });

  const setVariantField = (id: string, field: "tamanho" | "cor" | "estoque" | "vendidos", value: string) =>
    setProductForm((previous) => ({
      ...previous,
      variantes: previous.variantes.map((variant) =>
        variant.id === id
          ? { ...variant, [field]: field === "estoque" || field === "vendidos" ? value.replace(/[^\d]/g, "") : value }
          : variant
      ),
    }));

  return (
    <MiniVendorShell
      title="Produtos do Mini Vendor"
      subtitle={
        isAdminManagingVendor
          ? "Edicao administrativa do catalogo da lojinha selecionada."
          : "Catalogo separado do cadastro da empresa, com planos carregados somente quando o formulario abre."
      }
      backPath={backPath}
      actions={
        <Link
          href={editCompanyHref}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-300 hover:bg-zinc-800"
        >
          <Pencil size={14} />
          Editar Loja
        </Link>
      }
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
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-zinc-700 bg-black">
                  <Image src={profileLogo} alt={storeName} fill sizes="64px" className="object-cover" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    Catalogo da Lojinha
                  </p>
                  <h2 className="mt-1 text-xl font-black uppercase text-white">{storeName}</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase ${getVendorStatusClass(profile?.status)}`}>
                      {getVendorStatusLabel(profile?.status)}
                    </span>
                    <span className="inline-flex rounded-full border border-zinc-700 bg-black/30 px-3 py-1 text-[10px] font-black uppercase text-zinc-400">
                      Planos sob demanda
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void openCreateProduct()}
                disabled={!profile?.id || plansLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {plansLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Novo Produto
              </button>
            </div>

            {!profile ? (
              <div className="mt-5 rounded-2xl border border-zinc-800 bg-black/20 px-4 py-5 text-sm text-zinc-400">
                Cadastre a loja primeiro para liberar o catalogo.
              </div>
            ) : !isApproved ? (
              <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${getVendorStatusClass(profile.status)}`}>
                Sua loja segue em aprovacao, mas voce ja pode editar esta pagina e montar os produtos. Eles so entram na vitrine oficial depois da aprovacao.
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-zinc-800 bg-black/20 px-4 py-4 text-sm text-zinc-400">
                Esta tela carrega somente os produtos. Os planos aparecem apenas ao abrir o formulario.
              </div>
            )}
          </section>

          {profile ? (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
              {isProductOpen ? (
                <div className="space-y-4 rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black uppercase text-white">
                        {editingProductId ? "Editar Produto" : "Criar Produto"}
                      </h3>
                      <p className="text-[11px] text-zinc-500">Categoria fixa da sua lojinha e rascunho salvo nesta pagina.</p>
                    </div>
                    <button type="button" onClick={closeProductForm} className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 hover:bg-zinc-800">
                      <X size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <input value={productForm.nome} maxLength={PRODUCT_NAME_MAX_LENGTH} onChange={(event) => setProductForm((previous) => ({ ...previous, nome: event.target.value.slice(0, PRODUCT_NAME_MAX_LENGTH) }))} placeholder="Nome do produto" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                    <input value={storeName} disabled className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2.5 text-sm text-zinc-500" />
                    <input value={productForm.preco} onChange={(event) => setProductForm((previous) => ({ ...previous, preco: event.target.value }))} placeholder="Preco" inputMode="decimal" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                    <input value={productForm.precoAntigo} onChange={(event) => setProductForm((previous) => ({ ...previous, precoAntigo: event.target.value }))} placeholder="Preco antigo" inputMode="decimal" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                    <input value={productForm.estoque} onChange={(event) => setProductForm((previous) => ({ ...previous, estoque: event.target.value.replace(/[^\d]/g, "") }))} disabled={productForm.usarVariantes} placeholder="Estoque" inputMode="numeric" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50" />
                    <input value={productForm.lote} maxLength={PRODUCT_LOTE_MAX_LENGTH} onChange={(event) => setProductForm((previous) => ({ ...previous, lote: event.target.value.slice(0, PRODUCT_LOTE_MAX_LENGTH) }))} placeholder="Lote / promocao" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                    <div className="grid grid-cols-1 gap-2 md:col-span-2 md:grid-cols-[1fr_auto]">
                      <input value={productForm.img} maxLength={URL_MAX_LENGTH} onChange={(event) => setProductForm((previous) => ({ ...previous, img: event.target.value.slice(0, URL_MAX_LENGTH) }))} placeholder="URL da imagem" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                      <label className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black uppercase transition ${uploadingProductImage ? "cursor-wait border-zinc-700 bg-zinc-800 text-zinc-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}`}>
                        {uploadingProductImage ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                        {uploadingProductImage ? "Enviando..." : "Upload"}
                        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void handleUploadProductImage(event)} disabled={uploadingProductImage} />
                      </label>
                    </div>
                    <div className="md:col-span-2">
                      <ImageResizeHelpLink label="Diminuir a imagem do produto no favicon.io/favicon-converter" />
                    </div>
                    <textarea value={productForm.descricao} maxLength={PRODUCT_DESCRIPTION_MAX_LENGTH} onChange={(event) => setProductForm((previous) => ({ ...previous, descricao: event.target.value.slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH) }))} rows={3} placeholder="Descricao" className="resize-y rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 md:col-span-2" />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-3 rounded-xl border border-zinc-800 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-black uppercase text-white">Status de Venda</p>
                        <button type="button" onClick={() => setIsPlanModalOpen(true)} disabled={plansLoading} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60">
                          {plansLoading ? <Loader2 size={14} className="animate-spin" /> : <Tags size={14} />}
                          Planos
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(["ativo", "em_breve", "esgotado"] as ProductStatus[]).map((status) => (
                          <button key={status} type="button" onClick={() => setProductForm((previous) => ({ ...previous, status }))} className={`rounded-xl border px-3 py-3 text-[11px] font-black uppercase transition ${productForm.status === status ? getProductStatusClass(status) : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"}`}>
                            {status === "ativo" ? "Ativar" : status === "em_breve" ? "Em-breve" : "Esgotado"}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <input value={productForm.tagLabel} maxLength={PRODUCT_BADGE_MAX_LENGTH} onChange={(event) => setProductForm((previous) => ({ ...previous, tagLabel: event.target.value.slice(0, PRODUCT_BADGE_MAX_LENGTH) }))} placeholder="Texto da badge" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 md:col-span-1" />
                        <select value={productForm.tagColor} onChange={(event) => setProductForm((previous) => ({ ...previous, tagColor: event.target.value as ProductFormState["tagColor"] }))} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500">
                          <option value="zinc">Cinza</option>
                          <option value="emerald">Verde</option>
                          <option value="orange">Laranja</option>
                          <option value="purple">Roxo</option>
                          <option value="blue">Azul</option>
                          <option value="red">Vermelho</option>
                        </select>
                        <select value={productForm.tagEffect} onChange={(event) => setProductForm((previous) => ({ ...previous, tagEffect: event.target.value as ProductFormState["tagEffect"] }))} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500">
                          <option value="none">Sem efeito</option>
                          <option value="pulse">Pulse</option>
                          <option value="shine">Shine</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl border border-zinc-800 bg-black/20 p-4">
                      <label className="inline-flex items-center gap-2 text-[11px] font-bold text-zinc-400">
                        <input type="checkbox" checked={productForm.payment.enabled} onChange={(event) => setProductForm((previous) => ({ ...previous, payment: { ...previous.payment, enabled: event.target.checked } }))} className="accent-emerald-500" />
                        Usar pagamento proprio
                      </label>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <input value={productForm.payment.chave} maxLength={PIX_KEY_MAX_LENGTH} onChange={(event) => setProductForm((previous) => ({ ...previous, payment: { ...previous.payment, chave: event.target.value.slice(0, PIX_KEY_MAX_LENGTH) } }))} placeholder="Chave PIX" disabled={!productForm.payment.enabled} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50" />
                        <input value={productForm.payment.banco} maxLength={PIX_BANK_MAX_LENGTH} onChange={(event) => setProductForm((previous) => ({ ...previous, payment: { ...previous.payment, banco: event.target.value.slice(0, PIX_BANK_MAX_LENGTH) } }))} placeholder="Banco" disabled={!productForm.payment.enabled} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50" />
                        <input value={productForm.payment.titular} maxLength={PIX_HOLDER_MAX_LENGTH} onChange={(event) => setProductForm((previous) => ({ ...previous, payment: { ...previous.payment, titular: event.target.value.slice(0, PIX_HOLDER_MAX_LENGTH) } }))} placeholder="Titular" disabled={!productForm.payment.enabled} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50" />
                        <input value={productForm.payment.whatsapp} maxLength={PHONE_MAX_LENGTH} inputMode="tel" onChange={(event) => setProductForm((previous) => ({ ...previous, payment: { ...previous.payment, whatsapp: normalizePhoneToBrE164(event.target.value) } }))} placeholder="WhatsApp" disabled={!productForm.payment.enabled} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-zinc-800 bg-black/20 p-4">
                    <label className="inline-flex items-center gap-2 text-[11px] font-bold text-zinc-400">
                      <input type="checkbox" checked={productForm.usarVariantes} onChange={(event) => setProductForm((previous) => ({ ...previous, usarVariantes: event.target.checked }))} className="accent-emerald-500" />
                      Usar variacoes
                    </label>
                    {productForm.usarVariantes ? (
                      <div className="space-y-2">
                        {productForm.variantes.map((variant) => (
                          <div key={variant.id} className="grid grid-cols-12 gap-2">
                            <input value={variant.tamanho} maxLength={PRODUCT_VARIANT_FIELD_MAX_LENGTH} onChange={(event) => setVariantField(variant.id, "tamanho", event.target.value.slice(0, PRODUCT_VARIANT_FIELD_MAX_LENGTH))} placeholder="Tamanho" className="col-span-4 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500 md:col-span-3" />
                            <input value={variant.cor} maxLength={PRODUCT_VARIANT_FIELD_MAX_LENGTH} onChange={(event) => setVariantField(variant.id, "cor", event.target.value.slice(0, PRODUCT_VARIANT_FIELD_MAX_LENGTH))} placeholder="Cor" className="col-span-4 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500 md:col-span-3" />
                            <input value={variant.estoque} onChange={(event) => setVariantField(variant.id, "estoque", event.target.value)} placeholder="Qtd" inputMode="numeric" className="col-span-2 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500 md:col-span-2" />
                            <input value={variant.vendidos} onChange={(event) => setVariantField(variant.id, "vendidos", event.target.value)} placeholder="Vend." inputMode="numeric" className="col-span-2 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500 md:col-span-2" />
                            <button type="button" onClick={() => removeVariant(variant.id)} className="col-span-12 inline-flex items-center justify-center gap-1 rounded-lg border border-red-500/20 bg-red-500/5 py-2 text-xs font-bold text-red-300 hover:bg-red-500/10 md:col-span-2">
                              <Trash2 size={12} />
                              Remover
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={addVariant} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-700">
                          <Plus size={12} />
                          Adicionar variacao
                        </button>
                      </div>
                    ) : null}
                    <textarea value={productForm.coresText} maxLength={PRODUCT_COLORS_TEXT_MAX_LENGTH} onChange={(event) => setProductForm((previous) => ({ ...previous, coresText: event.target.value.slice(0, PRODUCT_COLORS_TEXT_MAX_LENGTH) }))} rows={2} placeholder={"Cores\n1 por linha"} className="w-full resize-y rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                    <textarea value={productForm.caracteristicasText} maxLength={PRODUCT_FEATURES_TEXT_MAX_LENGTH} onChange={(event) => setProductForm((previous) => ({ ...previous, caracteristicasText: event.target.value.slice(0, PRODUCT_FEATURES_TEXT_MAX_LENGTH) }))} rows={3} placeholder={"Caracteristicas\n1 por linha"} className="w-full resize-y rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                    <button type="button" onClick={closeProductForm} disabled={savingProduct} className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-xs font-black uppercase hover:bg-zinc-700 disabled:opacity-60">
                      Cancelar
                    </button>
                    <button type="button" onClick={() => void handleSaveProduct()} disabled={savingProduct || uploadingProductImage} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2.5 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60">
                      {savingProduct ? <Loader2 size={14} className="animate-spin" /> : editingProductId ? <Save size={14} /> : <Plus size={14} />}
                      {savingProduct ? "Salvando..." : editingProductId ? "Salvar Alteracoes" : "Criar Produto"}
                    </button>
                  </div>
                </div>
              ) : null}

              {products.length === 0 ? (
                <div className="rounded-2xl border border-zinc-800 bg-black/20 px-4 py-5 text-sm text-zinc-400">
                  Nenhum produto cadastrado ainda.
                </div>
              ) : (
                <div className="space-y-3">
                  {products.map((row) => (
                    <article key={row.id} className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-black/20 p-4">
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-700 bg-black">
                        <Image src={row.img || profileLogo} alt={row.nome || "Produto"} fill sizes="64px" className="object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-bold text-white">{row.nome || "Produto"}</p>
                          <span className={`rounded border px-2 py-0.5 text-[9px] font-black uppercase ${getProductStatusClass(row.status || "ativo")}`}>
                            {row.status === "em_breve" ? "Em-breve" : row.status === "esgotado" ? "Esgotado" : "Ativo"}
                          </span>
                        </div>
                        <p className="text-[11px] uppercase text-zinc-500">Estoque: {Number(row.estoque || 0)} | Lote: {row.lote || "-"}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-black text-emerald-400">R$ {Number(row.preco || 0).toFixed(2)}</p>
                        <button type="button" onClick={() => void openEditProduct(row)} className="mt-2 inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[10px] font-black uppercase text-blue-300 hover:bg-blue-500/20">
                          <Pencil size={12} />
                          Editar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {isPlanModalOpen && isProductOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
              <div className="w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black uppercase text-white">Preco e Visibilidade por Plano</h3>
                    <p className="text-[11px] text-zinc-500">So preencha quem tiver preco especial. Em branco, o plano usa o preco geral do produto.</p>
                  </div>
                  <button type="button" onClick={() => setIsPlanModalOpen(false)} className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 hover:bg-zinc-800">
                    <X size={14} />
                  </button>
                </div>
                <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                  {productForm.planScopeRows.map((entry) => (
                    <div key={entry.planId} className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-black/30 p-3 md:grid-cols-[1.2fr_1fr_auto]">
                      <div>
                        <p className="text-sm font-bold text-white">{entry.planName}</p>
                        <p className="text-[10px] text-zinc-500">
                          Em branco: usa o preco geral
                          {productForm.preco.trim() ? ` (R$ ${productForm.preco.trim()})` : "."}
                        </p>
                      </div>
                      <input value={entry.price} onChange={(event) => setProductForm((previous) => ({ ...previous, planScopeRows: previous.planScopeRows.map((row) => row.planId === entry.planId ? { ...row, price: event.target.value } : row) }))} placeholder={`Preco especial para ${entry.planName}`} inputMode="decimal" className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                      <label className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[11px] font-black uppercase text-zinc-300">
                        <input type="checkbox" checked={entry.visible} onChange={(event) => setProductForm((previous) => ({ ...previous, planScopeRows: previous.planScopeRows.map((row) => row.planId === entry.planId ? { ...row, visible: event.target.checked } : row) }))} className="accent-emerald-500" />
                        Visivel
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </MiniVendorShell>
  );
}
