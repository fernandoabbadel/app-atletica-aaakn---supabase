import {
  DEFAULT_PLATFORM_LANDING_CONFIG,
  DEFAULT_LOADING_PHRASES,
  DEFAULT_TENANT_LANDING_CONFIG,
  type LandingConfig,
} from "@/lib/adminLandingService";

export const TENANT_INITIAL_LANDING_CONFIG: LandingConfig = {
  ...DEFAULT_TENANT_LANDING_CONFIG,
  loadingPhrases: [...DEFAULT_LOADING_PHRASES],
};

export const PLATFORM_INITIAL_LANDING_CONFIG: LandingConfig = {
  ...DEFAULT_PLATFORM_LANDING_CONFIG,
  loadingPhrases: [...DEFAULT_LOADING_PHRASES],
};

export const mergeLandingConfig = (
  fallbackConfig: LandingConfig,
  data: LandingConfig
): LandingConfig => ({
  ...fallbackConfig,
  ...data,
  socialLinks: data.socialLinks || fallbackConfig.socialLinks || [],
  reviews: data.reviews || fallbackConfig.reviews || [],
  hiddenPartnerIds: data.hiddenPartnerIds || fallbackConfig.hiddenPartnerIds || [],
});

export const extractLandingEditorErrorMessage = (error: unknown): string => {
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
