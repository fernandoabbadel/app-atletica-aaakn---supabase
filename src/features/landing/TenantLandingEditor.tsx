"use client";

import { useEffect, useMemo, useState } from "react";
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
  fetchLandingConfig,
  saveLandingConfig,
  type LandingConfig,
} from "@/lib/adminLandingService";
import { isPermissionError } from "@/lib/backendErrors";
import { logActivity } from "@/lib/logger";
import { canManageTenant, isPlatformMaster } from "@/lib/roles";
import { fetchPublicTenantIdBySlugCached } from "@/lib/publicTenantLookup";
import { withTenantSlug } from "@/lib/tenantRouting";
import { hasValidPhoneLength, isValidEmail } from "@/utils/contactFields";

type TenantLandingEditorProps = {
  tenantSlug: string;
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

      try {
        const resolvedTenantId =
          normalizedActiveTenantSlug === normalizedRouteTenantSlug && activeTenantId.trim()
            ? activeTenantId.trim()
            : await fetchPublicTenantIdBySlugCached(normalizedRouteTenantSlug);

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

        const data = await fetchLandingConfig({
          fallbackConfig: TENANT_INITIAL_LANDING_CONFIG,
          tenantId: resolvedTenantId,
        });
        if (!mounted) return;

        setConfig(mergeLandingConfig(TENANT_INITIAL_LANDING_CONFIG, data));
      } catch (error: unknown) {
        if (!mounted) return;

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

      addToast("Landing do tenant atualizada com sucesso.", "success");
      router.refresh();
    } catch (error: unknown) {
      if (isPermissionError(error)) {
        addToast("Sem permissao para salvar a landing.", "error");
      } else {
        const message = extractLandingEditorErrorMessage(error);
        console.error(`Erro ao salvar landing do tenant: ${message}`);
        addToast(`Falha ao salvar landing: ${message}`, "error");
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
      brandDescription="Essa identidade aparece na landing publica do tenant."
      brandLogoUrl={tenantLogoUrl || "/logo.png"}
      brandLogoAlt={`Logo ${tenantSigla || tenantName || normalizedRouteTenantSlug || "Tenant"}`}
      brandLogoUnoptimized={(tenantLogoUrl || "").startsWith("http")}
      accentColor={palette.primary}
    />
  );
}
