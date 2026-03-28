import { NextResponse } from "next/server";

import { QueryMonitor } from "@/lib/queryMonitor";
import { cleanupExpiredRateLimitBuckets, consumeRateLimit } from "@/lib/rateLimiter";
import { ServerCache } from "@/lib/serverCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const revalidate = 300;

const MAX_PUBLIC_TENANTS_LIMIT = 60;
const TENANTS_SERVER_CACHE_TTL_MS = 5 * 60 * 1000;
const TENANTS_ENDPOINT = "/api/public/tenants";

const resolveRequestIp = (request: Request): string => {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const firstForwardedIp = forwardedFor.split(",")[0]?.trim();
  if (firstForwardedIp) return firstForwardedIp;

  const realIp = request.headers.get("x-real-ip") || "";
  if (realIp.trim()) return realIp.trim();

  return "unknown";
};

const isLocalDevelopmentRequest = (request: Request): boolean => {
  const host = (request.headers.get("host") || "").trim().toLowerCase();
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
};

type PublicTenantDirectoryEntry = {
  id: string;
  nome: string;
  sigla: string;
  slug: string;
  faculdade: string;
  cidade: string;
  curso: string;
  area: string;
  cnpj: string;
  contatoEmail: string;
  contatoTelefone: string;
  logoUrl: string;
  paletteKey: string;
  visibleInDirectory: boolean;
  allowPublicSignup: boolean;
  status: "active" | "inactive" | "blocked";
  createdAt: string;
  updatedAt: string;
};

const measurePayloadBytes = (payload: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return 0;
  }
};

const parseTenantStatus = (
  value: unknown
): "active" | "inactive" | "blocked" => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "inactive" || normalized === "blocked") {
    return normalized;
  }
  return "active";
};

const parseTenantEntry = (row: Record<string, unknown>): PublicTenantDirectoryEntry | null => {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const slug = typeof row.slug === "string" ? row.slug.trim().toLowerCase() : "";
  if (!id || !slug) return null;

  return {
    id,
    nome: typeof row.nome === "string" ? row.nome.trim() : "",
    sigla: typeof row.sigla === "string" ? row.sigla.trim() : "",
    slug,
    faculdade: typeof row.faculdade === "string" ? row.faculdade.trim() : "",
    cidade: typeof row.cidade === "string" ? row.cidade.trim() : "",
    curso: typeof row.curso === "string" ? row.curso.trim() : "",
    area: typeof row.area === "string" ? row.area.trim() : "",
    cnpj: typeof row.cnpj === "string" ? row.cnpj.trim() : "",
    contatoEmail:
      typeof row.contato_email === "string" ? row.contato_email.trim() : "",
    contatoTelefone:
      typeof row.contato_telefone === "string" ? row.contato_telefone.trim() : "",
    logoUrl: typeof row.logo_url === "string" ? row.logo_url.trim() : "",
    paletteKey: typeof row.palette_key === "string" ? row.palette_key.trim() : "green",
    visibleInDirectory:
      typeof row.visible_in_directory === "boolean" ? row.visible_in_directory : true,
    allowPublicSignup: typeof row.allow_public_signup === "boolean"
      ? row.allow_public_signup
      : true,
    status: parseTenantStatus(row.status),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
};

export async function GET(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "60", 10);
  const requestedSlug = url.searchParams.get("slug")?.trim().toLowerCase() || "";
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAX_PUBLIC_TENANTS_LIMIT, requestedLimit))
    : 60;
  const rateLimit = isLocalDevelopmentRequest(request)
    ? { allowed: true, remaining: 9999, resetAt: Date.now() + 60_000 }
    : consumeRateLimit(resolveRequestIp(request), "/api/public/tenants");

  if (!rateLimit.allowed) {
    const payload = { error: "Rate limit exceeded. Try again in 1 minute." };
    QueryMonitor.recordQuery({
      endpoint: TENANTS_ENDPOINT,
      method: "GET",
      durationMs: Date.now() - startedAt,
      payloadBytes: measurePayloadBytes(payload),
      cacheHit: false,
      statusCode: 429,
      tenantId: requestedSlug || "directory",
      error: payload.error,
    });
    return NextResponse.json(payload, {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(
          Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))
        ),
        "X-RateLimit-Remaining": "0",
      },
    });
  }

  if (Math.random() < 0.02) {
    cleanupExpiredRateLimitBuckets();
  }

  try {
    const baseQuery = supabaseAdmin
      .from("tenants")
      .select(
        "id,nome,sigla,slug,faculdade,cidade,curso,area,cnpj,contato_email,contato_telefone,logo_url,palette_key,visible_in_directory,allow_public_signup,status,created_at,updated_at"
      )
      .eq("status", "active");

    if (requestedSlug) {
      const cacheKey = `public:tenants:slug:${requestedSlug}`;
      const cachedTenant = ServerCache.get<PublicTenantDirectoryEntry>(cacheKey);
      const cacheHit = cachedTenant !== null;
      const tenant =
        cachedTenant ??
        (await (async (): Promise<PublicTenantDirectoryEntry | null> => {
          const { data, error } = await baseQuery.eq("slug", requestedSlug).maybeSingle();
          if (error) {
            throw error;
          }

          const parsed = parseTenantEntry((data || {}) as Record<string, unknown>);
          if (parsed && parsed.status === "active") {
            ServerCache.set(cacheKey, parsed, TENANTS_SERVER_CACHE_TTL_MS);
          }
          return parsed;
        })());
      if (!tenant || tenant.status !== "active") {
        const payload = { error: "Atletica nao encontrada." };
        QueryMonitor.recordQuery({
          endpoint: TENANTS_ENDPOINT,
          method: "GET",
          durationMs: Date.now() - startedAt,
          payloadBytes: measurePayloadBytes(payload),
          cacheHit,
          statusCode: 404,
          tenantId: requestedSlug,
          error: payload.error,
        });
        return NextResponse.json(
          payload,
          { status: 404 }
        );
      }

      QueryMonitor.recordQuery({
        endpoint: TENANTS_ENDPOINT,
        method: "GET",
        durationMs: Date.now() - startedAt,
        payloadBytes: measurePayloadBytes(tenant),
        cacheHit,
        statusCode: 200,
        tenantId: tenant.id,
      });
      return NextResponse.json(tenant, {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
          "X-RateLimit-Remaining": String(rateLimit.remaining),
        },
      });
    }

    const cacheKey = `public:tenants:list:${limit}`;
    const cachedTenants = ServerCache.get<PublicTenantDirectoryEntry[]>(cacheKey);
    const cacheHit = cachedTenants !== null;
    const tenants =
      cachedTenants ??
      (await (async (): Promise<PublicTenantDirectoryEntry[]> => {
        const { data, error } = await baseQuery
          .eq("visible_in_directory", true)
          .order("nome", { ascending: true })
          .limit(limit);

        if (error) {
          throw error;
        }

        const parsed = (Array.isArray(data) ? data : [])
          .map((row) => parseTenantEntry((row || {}) as Record<string, unknown>))
          .filter(
            (row): row is PublicTenantDirectoryEntry =>
              row !== null && row.status === "active"
          );
        ServerCache.set(cacheKey, parsed, TENANTS_SERVER_CACHE_TTL_MS);
        return parsed;
      })());

    QueryMonitor.recordQuery({
      endpoint: TENANTS_ENDPOINT,
      method: "GET",
      durationMs: Date.now() - startedAt,
      payloadBytes: measurePayloadBytes(tenants),
      cacheHit,
      statusCode: 200,
      tenantId: "directory",
    });
    return NextResponse.json(tenants, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      },
    });
  } catch (error: unknown) {
    console.error("Falha ao carregar diretorio publico de atleticas:", error);
    const payload = { error: "Falha ao carregar as atleticas publicas." };
    QueryMonitor.recordQuery({
      endpoint: TENANTS_ENDPOINT,
      method: "GET",
      durationMs: Date.now() - startedAt,
      payloadBytes: measurePayloadBytes(payload),
      cacheHit: false,
      statusCode: 500,
      tenantId: requestedSlug || "directory",
      error: error instanceof Error ? error.message : payload.error,
    });
    return NextResponse.json(payload, { status: 500 });
  }
}
