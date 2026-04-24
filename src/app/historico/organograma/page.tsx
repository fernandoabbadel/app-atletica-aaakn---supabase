"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Crown, Loader2, Shield, Users2 } from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  fetchOrganogramConfig,
  type OrganogramConfig,
  type OrganogramMemberRecord,
} from "@/lib/organogramService";
import { fetchCanonicalUserVisuals } from "@/lib/userVisualsService";
import { withTenantSlug } from "@/lib/tenantRouting";

type OrganogramDisplayMember = OrganogramMemberRecord & {
  nomeExibicao: string;
  fotoExibicao: string;
  detalheExibicao: string;
  isFallbackVisual: boolean;
};

const INITIAL_CONFIG: OrganogramConfig = {
  tituloPagina: "Organograma da Atlética",
  subtituloPagina: "Carregando lideranças...",
  membros: [],
  ordemSecoes: [],
};

const sectionIcon = (section: string) => {
  const normalized = section.trim().toLowerCase();
  if (normalized.includes("presid")) return Crown;
  if (normalized.includes("diret")) return Shield;
  return Users2;
};

export default function OrganogramaPage() {
  const { tenantId, tenantLogoUrl, tenantSigla, tenantSlug } = useTenantTheme();
  const [config, setConfig] = useState<OrganogramConfig>(INITIAL_CONFIG);
  const [members, setMembers] = useState<OrganogramDisplayMember[]>([]);
  const [loading, setLoading] = useState(true);
  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/historico") : "/historico";

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const nextConfig = await fetchOrganogramConfig({
          forceRefresh: false,
          tenantId: tenantId || undefined,
        });
        const linkedIds = nextConfig.membros
          .map((member) => member.userId?.trim() || "")
          .filter((memberId) => memberId.length > 0);
        const visuals = await fetchCanonicalUserVisuals(linkedIds);

        if (!mounted) return;

        setConfig(nextConfig);
        setMembers(
          nextConfig.membros.map((member) => {
            const visual = member.userId ? visuals.get(member.userId) : undefined;
            const fallbackLogo = tenantLogoUrl || "/logo.png";
            return {
              ...member,
              nomeExibicao:
                visual?.nome || member.nome || "Membro a definir",
              fotoExibicao: visual?.foto || member.foto || fallbackLogo,
              detalheExibicao:
                visual?.turma || (member.userId ? "Membro vinculado" : "Vinculação pendente"),
              isFallbackVisual: !visual,
            };
          })
        );
      } catch (error: unknown) {
        console.error("Erro ao carregar organograma:", error);
        if (!mounted) return;
        setConfig(INITIAL_CONFIG);
        setMembers([]);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [tenantId, tenantLogoUrl]);

  const groupedMembers = useMemo(() => {
    const grouped = new Map<string, OrganogramDisplayMember[]>();
    members.forEach((member) => {
      const key = member.secao || "Diretoria";
      const current = grouped.get(key) ?? [];
      current.push(member);
      grouped.set(key, current);
    });
    const orderedSections = [
      ...(config.ordemSecoes || []),
      ...Array.from(grouped.keys()).filter(
        (section) => !(config.ordemSecoes || []).includes(section)
      ),
    ];

    return orderedSections
      .map((section) => ({
        section,
        members: (grouped.get(section) || []).sort(
          (left, right) =>
            left.ordem - right.ordem ||
            left.cargo.localeCompare(right.cargo, "pt-BR")
        ),
      }))
      .filter((group) => group.members.length > 0);
  }, [config.ordemSecoes, members]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050505] text-brand">
        <Loader2 className="animate-spin" size={44} />
        <p className="text-xs font-black uppercase tracking-[0.35em] text-zinc-400">
          Montando organograma...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] pb-28 text-white selection:bg-brand-primary/30">
      <section className="relative overflow-hidden border-b border-white/5 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),transparent_42%),linear-gradient(180deg,#0b0b0b_0%,#050505_100%)] px-5 py-10">
        <div className="absolute inset-0 opacity-15 [background-size:18px_18px] [background-image:linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)]" />
        <div className="relative mx-auto max-w-5xl">
          <Link
            href={backHref}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur-md transition hover:border-brand hover:text-brand"
          >
            <ArrowLeft size={18} />
          </Link>

          <div className="mt-8">
            <div className="max-w-2xl">
              <p className="text-[11px] font-black uppercase tracking-[0.35em] text-brand">
                {tenantSigla || "USC"} • Lideranças
              </p>
              <h1 className="mt-3 text-4xl font-black uppercase tracking-tighter text-white md:text-5xl">
                {config.tituloPagina}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
                {config.subtituloPagina}
              </p>
            </div>

          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-5 py-8">
        {groupedMembers.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-14 text-center">
            <p className="text-lg font-black uppercase text-zinc-400">
              Organograma ainda vazio
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              A diretoria pode montar esta página no painel administrativo.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {groupedMembers.map((group) => {
              const Icon = sectionIcon(group.section);
              return (
                <section key={group.section} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand/30 bg-brand-primary/10 text-brand">
                      <Icon size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                        Núcleo
                      </p>
                      <h2 className="text-2xl font-black uppercase tracking-tight text-white">
                        {group.section}
                      </h2>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {group.members.map((member) => {
                      const profileHref = member.userId
                        ? tenantSlug
                          ? withTenantSlug(tenantSlug, `/perfil/${member.userId}`)
                          : `/perfil/${member.userId}`
                        : "";

                      return (
                      <article
                        key={member.id}
                        className="group relative overflow-hidden rounded-[28px] border border-zinc-800 bg-zinc-950/90 p-5 shadow-[0_25px_60px_rgba(0,0,0,0.35)] transition hover:border-brand/40"
                      >
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_35%)] opacity-0 transition group-hover:opacity-100" />
                        <div className="relative flex items-start gap-4">
                          <div
                            className={`relative h-20 w-20 overflow-hidden rounded-3xl border ${
                              member.isFallbackVisual
                                ? "border-zinc-700 bg-zinc-900"
                                : "border-brand/30 bg-black"
                            }`}
                          >
                            <Image
                              src={member.fotoExibicao}
                              alt={member.nomeExibicao}
                              fill
                              sizes="80px"
                              className={`object-cover ${
                                member.isFallbackVisual ? "opacity-70 grayscale" : ""
                              }`}
                              unoptimized={member.fotoExibicao.startsWith("http")}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-brand">
                              {member.cargo}
                            </p>
                            <h3 className="mt-2 text-xl font-black uppercase tracking-tight text-white">
                              {member.nomeExibicao}
                            </h3>
                            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
                              {member.detalheExibicao}
                            </p>
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              {member.isFallbackVisual ? (
                                <p className="inline-flex rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-400">
                                  Vinculação pendente
                                </p>
                              ) : null}
                              {profileHref ? (
                                <Link
                                  href={profileHref}
                                  className="inline-flex rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300 transition hover:bg-cyan-500/20"
                                >
                                  Abrir perfil
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </article>
                    )})}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
