"use client";

import { useEffect, useRef, useState } from "react";
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
  clearLandingEditorDraft,
  fetchLandingConfig,
  getStoredLandingEditorDraft,
  saveLandingConfig,
  storeLandingEditorDraft,
  type LandingConfig,
} from "@/lib/adminLandingService";
import { isPermissionError } from "@/lib/backendErrors";
import { logActivity } from "@/lib/logger";
import { isPlatformMaster } from "@/lib/roles";
import { hasValidPhoneLength, isValidEmail } from "@/utils/contactFields";

const requirePlatformMaster = (
  user: ReturnType<typeof useAuth>["user"]
): boolean => isPlatformMaster(user);

const isTransientLandingNetworkError = (error: unknown): boolean => {
  const text = extractLandingEditorErrorMessage(error).toLowerCase();
  return (
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("load failed") ||
    text.includes("fetch failed")
  );
};

export default function PlatformLandingEditor() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { palette, loading: tenantThemeLoading } = useTenantTheme();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<LandingConfig>(PLATFORM_INITIAL_LANDING_CONFIG);
  const skipNextDraftPersistRef = useRef(true);
  const draftReadyRef = useRef(false);

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
        const draftSnapshot = getStoredLandingEditorDraft({
          fallbackConfig: PLATFORM_INITIAL_LANDING_CONFIG,
        });
        const data = await fetchLandingConfig({
          fallbackConfig: PLATFORM_INITIAL_LANDING_CONFIG,
        });
        if (!mounted) return;
        const mergedServerConfig = mergeLandingConfig(PLATFORM_INITIAL_LANDING_CONFIG, data);
        const nextConfig = draftSnapshot
          ? mergeLandingConfig(mergedServerConfig, draftSnapshot.config)
          : mergedServerConfig;
        skipNextDraftPersistRef.current = true;
        draftReadyRef.current = true;
        setConfig(nextConfig);
        if (draftSnapshot) {
          addToast("Rascunho local da landing restaurado.", "info");
        }
      } catch (error: unknown) {
        if (!mounted) return;

        const fallbackDraft = getStoredLandingEditorDraft({
          fallbackConfig: PLATFORM_INITIAL_LANDING_CONFIG,
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
          addToast("Sem permissão para carregar a configuração da landing.", "error");
        } else {
          const message = extractLandingEditorErrorMessage(error);
          console.error(`Erro ao carregar landing da plataforma: ${message}`);
          addToast(`Erro ao carregar configurações: ${message}`, "error");
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

  useEffect(() => {
    if (!draftReadyRef.current) return;
    if (skipNextDraftPersistRef.current) {
      skipNextDraftPersistRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      storeLandingEditorDraft(config);
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [config]);

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

      clearLandingEditorDraft();
      addToast("Landing USC atualizada com sucesso.", "success");
    } catch (error: unknown) {
      storeLandingEditorDraft(config);
      if (isPermissionError(error)) {
        addToast("Sem permissão para salvar a landing.", "error");
      } else {
        const message = extractLandingEditorErrorMessage(error);
        console.error(`Erro ao salvar landing da plataforma: ${message}`);
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
