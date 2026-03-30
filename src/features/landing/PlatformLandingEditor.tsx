"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import LandingEditorShell from "./LandingEditorShell";
import {
  extractLandingEditorErrorMessage,
  mergeLandingConfig,
  PLATFORM_INITIAL_LANDING_CONFIG,
} from "./shared";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { PLATFORM_LOGO_URL } from "@/constants/platformBrand";
import {
  fetchLandingConfig,
  saveLandingConfig,
  type LandingConfig,
} from "@/lib/adminLandingService";
import { isPermissionError } from "@/lib/backendErrors";
import { logActivity } from "@/lib/logger";
import { isPlatformMaster } from "@/lib/roles";
import { hasValidPhoneLength, isValidEmail } from "@/utils/contactFields";

const requirePlatformMaster = (
  user: ReturnType<typeof useAuth>["user"]
): boolean => isPlatformMaster(user);

export default function PlatformLandingEditor() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { palette, loading: tenantThemeLoading } = useTenantTheme();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<LandingConfig>(PLATFORM_INITIAL_LANDING_CONFIG);

  useEffect(() => {
    if (authLoading || tenantThemeLoading) return;
    if (!requirePlatformMaster(user)) {
      addToast("Area exclusiva do master da plataforma.", "error");
      router.replace("/sem-permissao");
      return;
    }

    let mounted = true;

    const loadPlatformLanding = async () => {
      setLoading(true);
      try {
        const data = await fetchLandingConfig({
          fallbackConfig: PLATFORM_INITIAL_LANDING_CONFIG,
        });
        if (!mounted) return;
        setConfig(mergeLandingConfig(PLATFORM_INITIAL_LANDING_CONFIG, data));
      } catch (error: unknown) {
        if (!mounted) return;

        if (isPermissionError(error)) {
          addToast("Sem permissao para carregar a configuracao da landing.", "error");
        } else {
          const message = extractLandingEditorErrorMessage(error);
          console.error(`Erro ao carregar landing da plataforma: ${message}`);
          addToast(`Erro ao carregar configuracoes: ${message}`, "error");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadPlatformLanding();
    return () => {
      mounted = false;
    };
  }, [addToast, authLoading, router, tenantThemeLoading, user]);

  const handleSave = async () => {
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
      await saveLandingConfig(config);

      try {
        const refreshParams = new URLSearchParams({
          refresh: "1",
          scope: "platform",
        });
        await fetch(`/api/public/landing?${refreshParams.toString()}`, {
          cache: "no-store",
        });
      } catch (refreshError: unknown) {
        console.warn("Falha ao atualizar cache publico da landing global.", refreshError);
      }

      if (user) {
        await logActivity(
          user.uid,
          String(user.displayName || user.email || "Admin"),
          "UPDATE",
          "Landing USC",
          `Atualizou landing global. Destaque: ${config.heroHighlight}`
        );
      }

      addToast("Landing USC atualizada com sucesso.", "success");
      router.refresh();
    } catch (error: unknown) {
      if (isPermissionError(error)) {
        addToast("Sem permissao para salvar a landing.", "error");
      } else {
        const message = extractLandingEditorErrorMessage(error);
        console.error(`Erro ao salvar landing da plataforma: ${message}`);
        addToast(`Falha ao salvar landing: ${message}`, "error");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <LandingEditorShell
      scope="platform"
      loading={loading}
      saving={saving}
      config={config}
      setConfig={setConfig}
      onSave={handleSave}
      contextLabel="USC - Landing global"
      brandName="USC - Universidade Spot Connect"
      brandDescription="Essa identidade aparece na landing publica da plataforma."
      brandLogoUrl={PLATFORM_LOGO_URL}
      brandLogoAlt="Logo USC"
      accentColor={palette.primary}
    />
  );
}
