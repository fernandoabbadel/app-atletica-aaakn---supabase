export const TENANT_SLUG_COOKIE_NAME = "usc_tenant_slug";

const GLOBAL_ONLY_PREFIXES = [
  "/",
  "/login",
  "/cadastro",
  "/nova-atletica",
  "/empresa/cadastro",
  "/recuperar-senha",
  "/admin/master",
  "/admin/landing",
  "/auth",
];

const AUTO_SCOPE_PREFIXES = [
  "/dashboard",
  "/admin",
  "/perfil",
  "/eventos",
  "/loja",
  "/comunidade",
  "/album",
  "/treinos",
  "/games",
  "/ranking",
  "/planos",
  "/parceiros",
  "/fidelidade",
  "/historico",
  "/gym",
  "/carteirinha",
  "/empresa",
  "/sharkround",
  "/ligas",
  "/ligas_unitau",
  "/aguardando-aprovacao",
  "/sem-permissao",
  "/nao-encontrado",
  "/em-breve",
  "/configuracoes",
];

const RESERVED_ROOT_SEGMENTS = new Set([
  "_next",
  "api",
  "admin",
  "aguardando-aprovacao",
  "album",
  "arena-games",
  "auth",
  "banned",
  "cadastro",
  "carteirinha",
  "comunidade",
  "configuracoes",
  "conquistas",
  "dashboard",
  "em-breve",
  "empresa",
  "eventos",
  "fidelidade",
  "games",
  "guia",
  "gym",
  "historico",
  "ligas",
  "ligas_unitau",
  "loja",
  "login",
  "nao-encontrado",
  "nova-atletica",
  "parceiros",
  "perfil",
  "planos",
  "public",
  "ranking",
  "recuperar-senha",
  "sem-permissao",
  "sharkround",
  "treinos",
]);

const STATIC_FILE_RE = /\.[^/]+$/;
const TENANT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const normalizePathname = (pathname: string): string => {
  if (!pathname) return "/";
  const withSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
};

const startsWithPath = (pathname: string, prefix: string): boolean => {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
};

export const isSystemPath = (pathname: string): boolean => {
  const normalized = normalizePathname(pathname);
  return (
    normalized.startsWith("/_next/") ||
    normalized.startsWith("/api/") ||
    normalized === "/api" ||
    STATIC_FILE_RE.test(normalized)
  );
};

export const isGlobalOnlyPath = (pathname: string): boolean => {
  const normalized = normalizePathname(pathname);
  return GLOBAL_ONLY_PREFIXES.some((prefix) => startsWithPath(normalized, prefix));
};

export const shouldAutoScopePath = (pathname: string): boolean => {
  const normalized = normalizePathname(pathname);
  if (isSystemPath(normalized) || isGlobalOnlyPath(normalized)) return false;
  return AUTO_SCOPE_PREFIXES.some((prefix) => startsWithPath(normalized, prefix));
};

export const withTenantSlug = (tenantSlug: string, scopedPath: string): string => {
  const slug = tenantSlug.trim().toLowerCase();
  const normalizedPath = normalizePathname(scopedPath);
  if (!slug) return normalizedPath;
  if (normalizedPath === "/") return `/${slug}`;
  return `/${slug}${normalizedPath}`;
};

export type TenantScopedPathInfo = {
  tenantSlug: string;
  scopedPath: string;
  isTenantScoped: boolean;
};

export const parseTenantScopedPath = (pathname: string): TenantScopedPathInfo => {
  const normalized = normalizePathname(pathname);
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  const first = (segments[0] || "").toLowerCase();

  if (!first || RESERVED_ROOT_SEGMENTS.has(first) || first.includes(".") || !TENANT_SLUG_RE.test(first)) {
    return {
      tenantSlug: "",
      scopedPath: normalized,
      isTenantScoped: false,
    };
  }

  const scopedPath = segments.length > 1 ? `/${segments.slice(1).join("/")}` : "/";
  return {
    tenantSlug: first,
    scopedPath: normalizePathname(scopedPath),
    isTenantScoped: true,
  };
};
