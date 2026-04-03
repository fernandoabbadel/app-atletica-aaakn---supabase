import { NextResponse } from "next/server";

import { QueryMonitor } from "@/lib/queryMonitor";
import { cleanupExpiredRateLimitBuckets, consumeRateLimit } from "@/lib/rateLimiter";
import { ServerCache } from "@/lib/serverCache";
import {
  PUBLIC_TENANT_DIRECTORY_LIMIT_MAX,
  fetchPublicTenantBySlugWithAdmin,
  fetchPublicTenantDirectoryEntries,
  type PublicTenantDirectoryEntry,
} from "@/lib/publicTenantDirectoryService";

export const revalidate = 300;

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

const measurePayloadBytes = (payload: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return 0;
  }
};

export async function GET(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "60", 10);
  const requestedSlug = url.searchParams.get("slug")?.trim().toLowerCase() || "";
  const shouldRefresh = url.searchParams.get("refresh") === "1";
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(PUBLIC_TENANT_DIRECTORY_LIMIT_MAX, requestedLimit))
    : PUBLIC_TENANT_DIRECTORY_LIMIT_MAX;
  const rateLimit = isLocalDevelopmentRequest(request)
    ? { allowed: true, remaining: 9999, resetAt: Date.now() + 60_000 }
    : consumeRateLimit(resolveRequestIp(request), TENANTS_ENDPOINT);

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
    if (requestedSlug) {
      const cacheKey = `public:tenants:slug:${requestedSlug}`;
      if (shouldRefresh) {
        ServerCache.delete(cacheKey);
      }

      const cachedTenant = shouldRefresh
        ? null
        : ServerCache.get<PublicTenantDirectoryEntry>(cacheKey);
      const cacheHit = cachedTenant !== null;
      const tenant =
        cachedTenant ??
        (await (async (): Promise<PublicTenantDirectoryEntry | null> => {
          const entry = await fetchPublicTenantBySlugWithAdmin(requestedSlug);
          if (entry) {
            ServerCache.set(cacheKey, entry, TENANTS_SERVER_CACHE_TTL_MS);
          }
          return entry;
        })());

      if (!tenant) {
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
        return NextResponse.json(payload, { status: 404 });
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
    if (shouldRefresh) {
      ServerCache.delete(cacheKey);
    }

    const cachedTenants = shouldRefresh
      ? null
      : ServerCache.get<PublicTenantDirectoryEntry[]>(cacheKey);
    const cacheHit = cachedTenants !== null;
    const tenants =
      cachedTenants ??
      (await (async (): Promise<PublicTenantDirectoryEntry[]> => {
        const entries = await fetchPublicTenantDirectoryEntries(limit);
        ServerCache.set(cacheKey, entries, TENANTS_SERVER_CACHE_TTL_MS);
        return entries;
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
