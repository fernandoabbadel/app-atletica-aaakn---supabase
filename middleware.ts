import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  isGlobalOnlyPath,
  isSystemPath,
  parseTenantScopedPath,
  shouldAutoScopePath,
  TENANT_SLUG_COOKIE_NAME,
  withTenantSlug,
} from "@/lib/tenantRouting";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const TENANT_NATIVE_ROUTES = new Set(["/dashboard", "/eventos", "/loja"]);

const setTenantSlugCookie = (response: NextResponse, tenantSlug: string): void => {
  const cleanSlug = tenantSlug.trim().toLowerCase();
  if (!cleanSlug) {
    response.cookies.delete(TENANT_SLUG_COOKIE_NAME);
    return;
  }

  response.cookies.set({
    name: TENANT_SLUG_COOKIE_NAME,
    value: cleanSlug,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
  });
};

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname || "/";
  if (isSystemPath(pathname)) {
    return NextResponse.next();
  }

  const parsed = parseTenantScopedPath(pathname);
  if (parsed.isTenantScoped) {
    if (parsed.scopedPath === "/") {
      const response = NextResponse.next();
      setTenantSlugCookie(response, parsed.tenantSlug);
      return response;
    }

    if (TENANT_NATIVE_ROUTES.has(parsed.scopedPath)) {
      const response = NextResponse.next();
      setTenantSlugCookie(response, parsed.tenantSlug);
      return response;
    }

    if (isGlobalOnlyPath(parsed.scopedPath)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = parsed.scopedPath;
      const response = NextResponse.redirect(redirectUrl);
      setTenantSlugCookie(response, parsed.tenantSlug);
      return response;
    }

    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = parsed.scopedPath;
    const response = NextResponse.rewrite(rewriteUrl);
    setTenantSlugCookie(response, parsed.tenantSlug);
    return response;
  }

  const tenantSlugFromCookie = (request.cookies.get(TENANT_SLUG_COOKIE_NAME)?.value || "")
    .trim()
    .toLowerCase();

  if (!tenantSlugFromCookie || !shouldAutoScopePath(pathname)) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = withTenantSlug(tenantSlugFromCookie, pathname);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: "/:path*",
};
