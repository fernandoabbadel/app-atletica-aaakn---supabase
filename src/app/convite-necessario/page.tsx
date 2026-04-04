"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, Ticket } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  readStoredInviteToken,
  sanitizeInviteToken,
  storeInviteToken,
} from "@/lib/inviteTokenStorage";
import { withTenantSlug } from "@/lib/tenantRouting";

export default function ConviteNecessarioPage() {
  const searchParams = useSearchParams();
  const { tenantLogoUrl, tenantName, tenantSlug } = useTenantTheme();
  const inviteTokenFromUrl = sanitizeInviteToken(searchParams.get("invite"));
  const [effectiveInviteToken, setEffectiveInviteToken] = useState("");

  useEffect(() => {
    const nextInviteToken = inviteTokenFromUrl || readStoredInviteToken();
    if (inviteTokenFromUrl) {
      storeInviteToken(inviteTokenFromUrl);
    }
    setEffectiveInviteToken(nextInviteToken);
  }, [inviteTokenFromUrl]);

  const resolvedTenantSlug = tenantSlug.trim().toLowerCase();
  const resolvedTenantName = tenantName.trim() || "sua atletica";
  const inviteHref = useMemo(() => {
    const basePath = resolvedTenantSlug ? withTenantSlug(resolvedTenantSlug, "/cadastro") : "/cadastro";
    if (!effectiveInviteToken) return basePath;
    return `${basePath}?invite=${encodeURIComponent(effectiveInviteToken)}`;
  }, [effectiveInviteToken, resolvedTenantSlug]);
  const visitorHref = resolvedTenantSlug ? withTenantSlug(resolvedTenantSlug, "/") : "/visitante";

  return (
    <div className="min-h-screen bg-[#050505] px-6 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl flex-col items-center justify-center text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-amber-200">
          <LockKeyhole size={14} />
          Convite Obrigatorio
        </div>

        <div
          className="relative mb-8 flex h-40 w-40 items-center justify-center overflow-hidden rounded-full border-4 border-zinc-800 bg-black"
          style={{ boxShadow: "0 0 60px rgb(var(--tenant-primary-rgb) / 0.22)" }}
        >
          <div className="relative z-20 h-24 w-24">
            <Image
              src={tenantLogoUrl || "/logo.png"}
              alt={`Logo ${resolvedTenantName}`}
              fill
              sizes="96px"
              className="object-contain drop-shadow-2xl"
              priority
              unoptimized={(tenantLogoUrl || "").startsWith("http")}
            />
          </div>

          <div
            className="absolute left-[-50%] top-[24%] z-10 h-[200%] w-[200%] rounded-[40%] animate-invite-wave"
            style={{ backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.18)" }}
          />
          <div
            className="absolute left-[-50%] top-[28%] z-0 h-[200%] w-[200%] rounded-[45%] animate-invite-wave-reverse"
            style={{ backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.1)" }}
          />
        </div>

        <h1 className="text-2xl font-black uppercase tracking-[0.2em] text-white md:text-3xl">
          Necessario Convite
        </h1>
        <p className="mt-4 max-w-md text-sm leading-7 text-zinc-300">
          A entrada em <span className="font-black text-white">{resolvedTenantName}</span> esta
          fechada para cadastro publico. Para participar do app como membro, voce precisa abrir um
          convite ativo enviado por alguem dessa atletica.
        </p>

        <div className="mt-6 w-full rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 text-left backdrop-blur">
          <div className="flex items-start gap-3">
            <Ticket size={18} className="mt-0.5 text-cyan-300" />
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-200">
                Status do convite
              </p>
              <p className="mt-2 text-sm text-zinc-300">
                {effectiveInviteToken
                  ? "Encontramos um convite salvo para voce. Continue pelo cadastro para concluir a entrada."
                  : "Nenhum convite ativo foi detectado nesta sessao. Abra o link recebido para continuar."}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex w-full max-w-md flex-col gap-3">
          <Link
            href={inviteHref}
            className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-black uppercase transition ${
              effectiveInviteToken
                ? "bg-[var(--tenant-primary)] text-black hover:brightness-110"
                : "cursor-not-allowed border border-zinc-800 bg-zinc-900 text-zinc-500"
            }`}
            aria-disabled={!effectiveInviteToken}
            onClick={(event) => {
              if (!effectiveInviteToken) {
                event.preventDefault();
              }
            }}
          >
            <Ticket size={16} />
            {effectiveInviteToken ? "Continuar com meu convite" : "Aguardando link de convite"}
          </Link>

          <Link
            href={visitorHref}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-black px-5 py-3 text-sm font-black uppercase text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
          >
            <ArrowLeft size={16} />
            Abrir modo visitante
          </Link>
        </div>
      </div>

      <style jsx>{`
        @keyframes invite-wave {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        @keyframes invite-wave-reverse {
          0% {
            transform: rotate(360deg);
          }
          100% {
            transform: rotate(0deg);
          }
        }
        .animate-invite-wave {
          animation: invite-wave 7s linear infinite;
        }
        .animate-invite-wave-reverse {
          animation: invite-wave-reverse 10s linear infinite;
        }
      `}</style>
    </div>
  );
}
