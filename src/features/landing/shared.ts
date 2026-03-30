import {
  DEFAULT_LANDING_CONFIG,
  DEFAULT_LOADING_PHRASES,
  type LandingConfig,
} from "@/lib/adminLandingService";

export const TENANT_INITIAL_LANDING_CONFIG: LandingConfig = {
  tagline: "Gestao Esportiva 2.0",
  taglineColor: "#10b981",
  heroTitle: "SEJA UM",
  heroSubtitle: "Centralize sua vida universitaria. Carteirinha, Loja e Eventos.",
  heroHighlight: "SUA ATLETICA",
  titleColor: "#ffffff",
  gradientStart: "#34d399",
  gradientEnd: "#10b981",
  statUsers: 120,
  statPosts: 340,
  statPartners: 12,
  address: "Campus principal",
  phone: "",
  whatsapp: "",
  email: "",
  loadingPhrases: [...DEFAULT_LOADING_PHRASES],
  socialLinks: [],
  reviews: [],
};

export const PLATFORM_INITIAL_LANDING_CONFIG: LandingConfig = {
  ...DEFAULT_LANDING_CONFIG,
  heroTitle: "ENTRE PARA",
  heroHighlight: "SPOT CONNECT",
  heroSubtitle: "Plataforma oficial multi-atleticas.",
};

export const mergeLandingConfig = (
  fallbackConfig: LandingConfig,
  data: LandingConfig
): LandingConfig => ({
  ...fallbackConfig,
  ...data,
  socialLinks: data.socialLinks || fallbackConfig.socialLinks || [],
  reviews: data.reviews || fallbackConfig.reviews || [],
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
