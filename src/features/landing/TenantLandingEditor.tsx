"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import LandingEditorShell from "./LandingEditorShell";
import {
  extractLandingEditorErrorMessage,
  mergeLandingConfig,
  TENANT_INITIAL_LANDING_CONFIG,
} from "./shared";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  clearLandingEditorDraft,
  fetchLandingConfig,
  getStoredLandingEditorDraft,
  saveLandingConfig,
  storeLandingEditorDraft,
  type LandingConfig,
} from "@/lib/adminLandingService";
import { isPermissionError } from "@/lib/backendErrors";
import { logActivity } from "@/lib/logger";
import { fetchAdminPartnersPage, type PartnerRecord } from "@/lib/partnersService";
import { canManageTenant, isPlatformMaster } from "@/lib/roles";
import { fetchPublicTenantIdBySlugCached } from "@/lib/publicTenantLookup";
import { withTenantSlug } from "@/lib/tenantRouting";
import { hasValidPhoneLength, isValidEmail } from "@/utils/contactFields";

type TenantLandingEditorProps = {
  tenantSlug: string;
};

const isTransientLandingNetworkError = (error: unknown): boolean => {
  const text = extractLandingEditorErrorMessage(error).toLowerCase();
  return (
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("load failed") ||
    text.includes("fetch failed")
  );
};

const requireTenantAdmin = (
  user: ReturnType<typeof useAuth>["user"],
  routeTenantId: string
): boolean => {
  const cleanRouteTenantId = routeTenantId.trim();
  if (!user || !cleanRouteTenantId) return false;
  if (isPlatformMaster(user)) return true;
  if (!canManageTenant(user)) return false;

  const userTenantId =
    typeof user.tenant_id === "string" ? user.tenant_id.trim() : "";
  return userTenantId === cleanRouteTenantId;
};

export default function TenantLandingEditor({
  tenantSlug,
}: TenantLandingEditorProps) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const {
    tenantId: activeTenantId,
    tenantName,
    tenantSigla,
    tenantSlug: activeTenantSlug,
    tenantLogoUrl,
    palette,
    loading: tenantThemeLoading,
  } = useTenantTheme();
  const { addToast } = useToast();

  const normalizedRouteTenantSlug = tenantSlug.trim().toLowerCase();
  const normalizedActiveTenantSlug = activeTenantSlug.trim().toLowerCase();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [routeTenantId, setRouteTenantId] = useState("");
  const [config, setConfig] = useState<LandingConfig>(TENANT_INITIAL_LANDING_CONFIG);
  const [partnerRows, setPartnerRows] = useState<PartnerRecord[]>([]);
  const skipNextDraftPersistRef = useRef(true);
  const draftReadyRef = useRef(false);

  const contextLabel = useMemo(() => {
    const label =
      tenantSigla || tenantName || normalizedRouteTenantSlug.toUpperCase() || "Tenant atual";
    return `${label} - Landing do tenant`;
  }, [normalizedRouteTenantSlug, tenantName, tenantSigla]);

  useEffect(() => {
    if (authLoading || tenantThemeLoading) return;
    if (!normalizedRouteTenantSlug) {
      router.replace("/nao-encontrado");
      return;
    }

    let mounted = true;

    const loadTenantLanding = async () => {
      setLoading(true);
      let resolvedTenantIdForDraft = "";

      try {
        const resolvedTenantId =
          normalizedActiveTenantSlug === normalizedRouteTenantSlug && activeTenantId.trim()
            ? activeTenantId.trim()
            : await fetchPublicTenantIdBySlugCached(normalizedRouteTenantSlug);
        resolvedTenantIdForDraft = resolvedTenantId?.trim() || resolvedTenantIdForDraft;

        if (!mounted) return;

        if (!resolvedTenantId) {
          addToast("Tenant nao encontrado para editar a landing.", "error");
          router.replace(withTenantSlug(normalizedRouteTenantSlug, "/nao-encontrado"));
          return;
        }

        if (!requireTenantAdmin(user, resolvedTenantId)) {
          addToast("Sem permissao para editar a landing deste tenant.", "error");
          router.replace(withTenantSlug(normalizedRouteTenantSlug, "/sem-permissao"));
          return;
        }

        setRouteTenantId(resolvedTenantId);
        const draftSnapshot = getStoredLandingEditorDraft({
          tenantId: resolvedTenantId,
          fallbackConfig: TENANT_INITIAL_LANDING_CONFIG,
        });

        const fetchAllTenantPartners = async (): Promise<PartnerRecord[]> => {
          const collected: PartnerRecord[] = [];
          const seen = new Set<string>();
          let nextCursor: string | null = null;
          let hasMore = true;

          while (hasMore) {
            const page = await fetchAdminPartnersPage({
              pageSize: 200,
              cursorId: nextCursor,
              status: "all",
              view: "summary",
              forceRefresh: nextCursor === null,
              tenantId: resolvedTenantId,
            });

            page.partners.forEach((partner) => {
              if (seen.has(partner.id)) return;
              seen.add(partner.id);
              collected.push(partner);
            });

            hasMore = page.hasMore && Boolean(page.nextCursor);
            nextCursor = page.nextCursor;
          }

          return collected.sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));
        };

        const [data, partners] = await Promise.all([
          fetchLandingConfig({
            fallbackConfig: TENANT_INITIAL_LANDING_CONFIG,
            tenantId: resolvedTenantId,
          }),
          fetchAllTenantPartners(),
        ]);
        if (!mounted) return;

        const mergedServerConfig = mergeLandingConfig(TENANT_INITIAL_LANDING_CONFIG, data);
        const nextConfig = draftSnapshot
          ? mergeLandingConfig(mergedServerConfig, draftSnapshot.config)
          : mergedServerConfig;
        skipNextDraftPersistRef.current = true;
        draftReadyRef.current = true;
        setConfig(nextConfig);
        setPartnerRows(partners);
        if (draftSnapshot) {
          addToast("Rascunho local da landing restaurado.", "info");
        }
      } catch (error: unknown) {
        if (!mounted) return;

        const fallbackDraft = getStoredLandingEditorDraft({
          tenantId: resolvedTenantIdForDraft,
          fallbackConfig: TENANT_INITIAL_LANDING_CONFIG,
        });
        if (fallbackDraft) {
          skipNextDraftPersistRef.current = true;
          draftReadyRef.current = true;
          setConfig(fallbackDraft.config);
          addToast("Conexao falhou ao carregar. Rascunho local restaurado.", "info");
          setLoading(false);
          return;
        }

        if (isPermissionError(error)) {
          addToast("Sem permissao para carregar a configuracao da landing.", "error");
        } else {
          const message = extractLandingEditorErrorMessage(error);
          console.error(`Erro ao carregar landing do tenant: ${message}`);
          addToast(`Erro ao carregar configuracoes: ${message}`, "error");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadTenantLanding();
    return () => {
      mounted = false;
    };
  }, [
    activeTenantId,
    addToast,
    authLoading,
    normalizedActiveTenantSlug,
    normalizedRouteTenantSlug,
    router,
    tenantThemeLoading,
    user,
  ]);

  useEffect(() => {
    if (!draftReadyRef.current) return;
    if (skipNextDraftPersistRef.current) {
      skipNextDraftPersistRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      storeLandingEditorDraft(config, routeTenantId);
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [config, routeTenantId]);

  const handleSave = async () => {
    if (!routeTenantId.trim()) {
      addToast("Tenant nao resolvido para salvar a landing.", "error");
      return;
    }
    if (config.email.trim() && !isValidEmail(config.email)) {
      addToast("Informe um email valido para a landing.", "error");
      return;
    }
    if (config.whatsapp.trim() && !hasValidPhoneLength(config.whatsapp)) {
      addToast("Informe um WhatsApp valido para a landing.", "error");
      return;
    }

    setSaving(true);
    try {
      await saveLandingConfig(config, { tenantId: routeTenantId });

      try {
        const refreshParams = new URLSearchParams({
          refresh: "1",
          tenant: normalizedRouteTenantSlug,
        });
        await fetch(`/api/public/landing?${refreshParams.toString()}`, {
          cache: "no-store",
        });
      } catch (refreshError: unknown) {
        console.warn("Falha ao atualizar cache publico da landing do tenant.", refreshError);
      }

      if (user) {
        await logActivity(
          user.uid,
          String(user.displayName || user.email || "Admin"),
          "UPDATE",
          "Landing Tenant",
          `Atualizou landing do tenant ${normalizedRouteTenantSlug}. Destaque: ${config.heroHighlight}`
        );
      }

      clearLandingEditorDraft(routeTenantId);
      addToast("Landing do tenant atualizada com sucesso.", "success");
    } catch (error: unknown) {
      storeLandingEditorDraft(config, routeTenantId);
      if (isPermissionError(error)) {
        addToast("Sem permissao para salvar a landing.", "error");
      } else {
        const message = extractLandingEditorErrorMessage(error);
        console.error(`Erro ao salvar landing do tenant: ${message}`);
        addToast(
          isTransientLandingNetworkError(error)
            ? `Falha de rede ao salvar. Seu rascunho local foi preservado. Detalhe: ${message}`
            : `Falha ao salvar landing: ${message}`,
          "error"
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <LandingEditorShell
      scope="tenant"
      loading={loading}
      saving={saving}
      config={config}
      setConfig={setConfig}
      onSave={handleSave}
      contextLabel={contextLabel}
      brandName={
        tenantName || tenantSigla || normalizedRouteTenantSlug.toUpperCase() || "Tenant atual"
      }
      brandDescription="Esse bloco vem do branding do tenant e nao dos campos de conteudo da landing."
      brandLogoUrl={tenantLogoUrl || "/logo.png"}
      brandLogoAlt={`Logo ${tenantSigla || tenantName || normalizedRouteTenantSlug || "Tenant"}`}
      brandLogoUnoptimized={(tenantLogoUrl || "").startsWith("http")}
      accentColor={palette.primary}
      brandManagePath={withTenantSlug(normalizedRouteTenantSlug, "/admin/atletica")}
      brandManageLabel="Editar marca da atletica"
      partnerRows={partnerRows}
    />
  );
}
