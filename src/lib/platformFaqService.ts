import { getSupabaseClient } from "./supabase";
import {
  DEFAULT_PLATFORM_FAQ_CONFIG,
  sanitizePlatformFaqConfig,
  type PlatformFaqConfig,
} from "./platformFaqConfig";

export type PlatformFaqPayload = {
  config: PlatformFaqConfig;
  source?: "official" | "fallback";
};

const extractApiError = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Ignora parse invalido e usa mensagem generica.
  }
  return `Falha na API do FAQ (${response.status}).`;
};

export async function fetchPlatformFaqConfig(options?: {
  forceRefresh?: boolean;
}): Promise<PlatformFaqPayload> {
  const searchParams = new URLSearchParams();
  if (options?.forceRefresh) {
    searchParams.set("refresh", "1");
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const response = await fetch(`/api/public/faq${suffix}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await extractApiError(response));
  }

  const payload = (await response.json()) as Partial<PlatformFaqPayload>;
  return {
    config: sanitizePlatformFaqConfig(payload.config, DEFAULT_PLATFORM_FAQ_CONFIG),
    source: payload.source === "official" ? "official" : "fallback",
  };
}

export async function savePlatformFaqConfig(
  config: PlatformFaqConfig
): Promise<PlatformFaqPayload> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token || "";

  if (!accessToken) {
    throw new Error("Sessao ausente para salvar o FAQ.");
  }

  const response = await fetch("/api/public/faq", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      config: sanitizePlatformFaqConfig(config, config),
    }),
  });

  if (!response.ok) {
    throw new Error(await extractApiError(response));
  }

  const payload = (await response.json()) as Partial<PlatformFaqPayload>;
  return {
    config: sanitizePlatformFaqConfig(payload.config, config),
    source: "official",
  };
}
