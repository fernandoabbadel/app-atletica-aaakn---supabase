"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Waves } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { PLATFORM_LOGO_URL } from "@/constants/platformBrand";
import {
  clearStoredLoginReturnTo,
  readStoredLoginReturnTo,
  sanitizeReturnToPath,
} from "@/lib/authRedirect";
import {
  readStoredInviteToken,
  sanitizeInviteToken,
  storeInviteToken,
} from "@/lib/inviteTokenStorage";
import { fetchPublicTenantBySlugCached } from "@/lib/publicTenantLookup";
import { resolveTenantInviteGateRedirect } from "@/lib/inviteAccessGate";
import { isPlatformMaster } from "@/lib/roles";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";

const normalizeUserText = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export default function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const { loginAsGuest, loginGoogle, user, loading } = useAuth();
  const { tenantSlug: activeTenantSlug, loading: tenantThemeLoading } = useTenantTheme();

  const [isLoading, setIsLoading] = useState(false);
  const [inviteTokenHydrated, setInviteTokenHydrated] = useState(false);
  const inviteTokenFromUrl = sanitizeInviteToken(searchParams.get("invite"));
  const [effectiveInviteToken, setEffectiveInviteToken] = useState(
    inviteTokenFromUrl || readStoredInviteToken()
  );
  const requestedReturnTo = sanitizeReturnToPath(searchParams.get("returnTo"));
  const storedReturnToHint = readStoredLoginReturnTo() ?? "/dashboard";
  const tenantScopedCadastroPath = activeTenantSlug.trim()
    ? withTenantSlug(activeTenantSlug, "/cadastro")
    : "/cadastro";
  const requestedTenantReturnTo = parseTenantScopedPath(requestedReturnTo).tenantSlug
    ? requestedReturnTo
    : "";
  const storedTenantReturnTo = parseTenantScopedPath(storedReturnToHint).tenantSlug
    ? storedReturnToHint
    : "";
  const inviteAwareReturnTo = effectiveInviteToken
    ? requestedTenantReturnTo ||
      storedTenantReturnTo ||
      (requestedReturnTo !== "/dashboard" ? requestedReturnTo : "") ||
      (storedReturnToHint !== "/dashboard" ? storedReturnToHint : "") ||
      tenantScopedCadastroPath
    : requestedReturnTo !== "/dashboard"
      ? requestedReturnTo
      : storedReturnToHint;
  const redirectCommittedRef = useRef(false);
  const normalizedActiveTenantSlug = activeTenantSlug.trim().toLowerCase();
  const targetTenantSlug =
    parseTenantScopedPath(inviteAwareReturnTo).tenantSlug ||
    parseTenantScopedPath(storedReturnToHint).tenantSlug ||
    normalizedActiveTenantSlug;
  const normalizedTenantStatus = normalizeUserText(user?.tenant_status);
  const normalizedTenantId =
    typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "";
  const isPlatformMasterUser = isPlatformMaster(user);
  const isPendingTenant =
    normalizedTenantStatus === "pending" && normalizedTenantId.length > 0;
  const isApprovedTenant =
    normalizedTenantId.length > 0 &&
    (normalizedTenantStatus === "" || normalizedTenantStatus === "approved");
  const tenantScopedLandingPath = normalizedActiveTenantSlug
    ? withTenantSlug(normalizedActiveTenantSlug, "/")
    : "/dashboard";
  const tenantScopedPendingPath = normalizedActiveTenantSlug
    ? withTenantSlug(normalizedActiveTenantSlug, "/aguardando-aprovacao")
    : "/aguardando-aprovacao";
  const [targetTenantAllowPublicSignup, setTargetTenantAllowPublicSignup] = useState<boolean | null>(
    null
  );
  const [targetTenantLoading, setTargetTenantLoading] = useState(false);

  const canUseUnscopedCandidate = useCallback(
    (candidate: string): boolean => {
      if (!user) return false;

      if (user.isAnonymous) {
        return candidate === "/visitante";
      }

      if (candidate === "/visitante") return false;
      if (candidate === "/cadastro") {
        return !isPlatformMasterUser && !isApprovedTenant;
      }
      if (candidate === "/aguardando-aprovacao") {
        return isPendingTenant;
      }
      if (candidate === "/master" || candidate.startsWith("/master/")) {
        return isPlatformMasterUser;
      }

      return true;
    },
    [isApprovedTenant, isPendingTenant, isPlatformMasterUser, user]
  );

  const resolveRedirectTarget = useCallback((): string => {
    if (!user) return "/visitante";

    const fallbackTarget = user.isAnonymous
      ? "/visitante"
      : isPlatformMasterUser
        ? "/master"
        : isPendingTenant
          ? tenantScopedPendingPath
          : isApprovedTenant
            ? tenantScopedLandingPath
            : tenantScopedCadastroPath;

    const candidateTargets = [
      inviteAwareReturnTo,
      readStoredLoginReturnTo() ?? "",
    ].filter((candidate) => candidate && candidate !== "/dashboard");

    for (const candidate of candidateTargets) {
      const { tenantSlug, scopedPath } = parseTenantScopedPath(candidate);
      if (!tenantSlug) {
        if (canUseUnscopedCandidate(candidate)) {
          return candidate;
        }
        continue;
      }

      if (
        isPlatformMasterUser ||
        tenantSlug === normalizedActiveTenantSlug ||
        (!user.isAnonymous && scopedPath === "/cadastro" && !isApprovedTenant) ||
        (!user.isAnonymous && scopedPath === "/aguardando-aprovacao" && isPendingTenant)
      ) {
        return candidate;
      }
    }

    return fallbackTarget;
  }, [
    canUseUnscopedCandidate,
    inviteAwareReturnTo,
    isApprovedTenant,
    isPendingTenant,
    isPlatformMasterUser,
    normalizedActiveTenantSlug,
    tenantScopedCadastroPath,
    tenantScopedLandingPath,
    tenantScopedPendingPath,
    user,
  ]);

  useEffect(() => {
    const nextInviteToken = inviteTokenFromUrl || readStoredInviteToken();
    if (inviteTokenFromUrl) {
      storeInviteToken(inviteTokenFromUrl);
    }
    setEffectiveInviteToken(nextInviteToken);
    setInviteTokenHydrated(true);
  }, [inviteTokenFromUrl]);

  useEffect(() => {
    if (!targetTenantSlug) {
      setTargetTenantAllowPublicSignup(null);
      setTargetTenantLoading(false);
      return;
    }

    let mounted = true;
    setTargetTenantLoading(true);

    const loadTenant = async () => {
      try {
        const tenant = await fetchPublicTenantBySlugCached(targetTenantSlug);
        if (!mounted) return;
        setTargetTenantAllowPublicSignup(
          typeof tenant?.allowPublicSignup === "boolean" ? tenant.allowPublicSignup : null
        );
      } catch {
        if (!mounted) return;
        setTargetTenantAllowPublicSignup(null);
      } finally {
        if (mounted) {
          setTargetTenantLoading(false);
        }
      }
    };

    void loadTenant();
    return () => {
      mounted = false;
    };
  }, [targetTenantSlug]);

  useEffect(() => {
    if (redirectCommittedRef.current) return;
    if (loading) return;
    if (!user) return;
    if (!inviteTokenHydrated) return;
    if (!user.isAnonymous && tenantThemeLoading) return;
    if (
      !user.isAnonymous &&
      !isPlatformMasterUser &&
      !isPendingTenant &&
      !isApprovedTenant &&
      targetTenantSlug &&
      targetTenantLoading
    ) {
      return;
    }

    setIsLoading(false);
    const blocked = user.status === "banned" || user.status === "bloqueado";
    if (blocked) {
      redirectCommittedRef.current = true;
      clearStoredLoginReturnTo();
      router.replace("/banned");
      return;
    }
    const inviteGateRedirectPath =
      !user.isAnonymous && !isPlatformMasterUser && !isPendingTenant && !isApprovedTenant
        ? resolveTenantInviteGateRedirect({
            user,
            tenantId: normalizedTenantId,
            tenantSlug: targetTenantSlug,
            allowPublicSignup: targetTenantAllowPublicSignup,
            hasInviteToken: Boolean(effectiveInviteToken),
          })
        : null;
    const redirectTarget = inviteGateRedirectPath || resolveRedirectTarget();
    redirectCommittedRef.current = true;
    clearStoredLoginReturnTo();
    router.replace(redirectTarget);
  }, [
    effectiveInviteToken,
    inviteTokenHydrated,
    isApprovedTenant,
    isPendingTenant,
    isPlatformMasterUser,
    loading,
    normalizedTenantId,
    resolveRedirectTarget,
    router,
    targetTenantAllowPublicSignup,
    targetTenantLoading,
    targetTenantSlug,
    tenantThemeLoading,
    user,
  ]);

  const handleGuestLogin = async () => {
    try {
      setIsLoading(true);
      addToast("Gerando cracha de visitante...", "info");
      await loginAsGuest();
      router.push("/visitante");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao entrar como visitante.", "error");
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      await loginGoogle({
        returnTo: inviteAwareReturnTo,
        inviteToken: effectiveInviteToken || undefined,
      });
    } catch {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#02050d] relative overflow-hidden flex flex-col items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-[#071735] via-[#02050d] to-[#01030a]" />
      </div>

      <div className="relative z-10 mb-8 animate-float-slow text-center">
        <div className="relative inline-block">
          <Image
            src={PLATFORM_LOGO_URL}
            alt="USC Logo"
            width={192}
            height={192}
            className="w-40 h-40 md:w-48 md:h-48 object-contain mix-blend-screen drop-shadow-[0_0_30px_rgba(59,130,246,0.3)] mx-auto"
            priority
          />
          <div className="absolute inset-0 bg-brand-primary/20 blur-3xl rounded-full -z-10 scale-75" />
        </div>

        <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mt-4">
          UNIVERSIDADE{" "}
          <span
            className="text-transparent bg-clip-text"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--tenant-primary), var(--tenant-accent))",
            }}
          >
            SPOT CONNECT
          </span>
        </h1>
        <p className="text-zinc-400 text-sm mt-2 flex items-center justify-center gap-2">
          <Waves className="w-4 h-4 text-brand" />
          Plataforma oficial multi-atleticas
          <Waves className="w-4 h-4 text-brand" />
        </p>
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="bg-zinc-900/80 backdrop-blur-xl rounded-3xl border border-brand p-6 shadow-brand">
          <div className="rounded-2xl border border-zinc-800 bg-black/20 px-4 py-4 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Acesso
            </p>
            <p className="mt-2 text-sm text-zinc-300">
              O login por email institucional foi pausado. Entre com Google para continuar.
            </p>
          </div>

          <div className="mt-5 space-y-3">
            {effectiveInviteToken && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-left">
                <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-200">
                  Convite detectado
                </p>
                <p className="mt-1 text-xs text-cyan-100/80">
                  O token foi salvo e sera reaplicado depois do retorno do Google.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full py-3 bg-white text-black font-bold text-sm rounded-xl transition hover:bg-zinc-200 flex items-center justify-center gap-2"
            >
              <Image
                src="https://www.svgrepo.com/show/475656/google-color.svg"
                width={20}
                height={20}
                className="w-5 h-5"
                alt="Google Logo"
                unoptimized
              />
              Entrar com Google
            </button>

            <button
              type="button"
              onClick={handleGuestLogin}
              disabled={isLoading}
              className="w-full py-3 bg-transparent hover:bg-zinc-800/50 text-zinc-400 hover:text-white font-bold text-xs uppercase tracking-wider rounded-xl transition border border-dashed border-zinc-700 hover:border-brand mt-2"
            >
              Apenas dar uma espiadinha (Visitante)
            </button>
          </div>
        </div>

        <p className="text-center text-zinc-600 text-[10px] mt-6">
          Ao entrar, voce concorda com nossos{" "}
          <button type="button" className="text-brand-accent hover:underline">
            Termos
          </button>{" "}
          e{" "}
          <button type="button" className="text-brand-accent hover:underline">
            Privacidade
          </button>
        </p>
      </div>

      <style jsx>{`
        .animate-float-slow {
          animation: float-slow 4s ease-in-out infinite;
        }

        @keyframes float-slow {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-15px);
          }
        }
      `}</style>
    </div>
  );
}
