"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  Package,
  Pencil,
  Store,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchCurrentMiniVendorProfile,
  type MiniVendorProfile,
} from "@/lib/miniVendorService";
import { withTenantSlug } from "@/lib/tenantRouting";

import { getVendorStatusClass, getVendorStatusLabel } from "./_shared";
import { MiniVendorShell } from "./_components/MiniVendorShell";

export default function MiniVendorSettingsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantLogoUrl, tenantSlug } = useTenantTheme();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<MiniVendorProfile | null>(null);

  const canUseArea = Boolean(user?.uid) && Boolean(tenantId.trim());
  const links = useMemo(
    () => [
      {
        title: "Editar dados da empresa",
        description:
          "Abre uma pagina propria para nome, descricao, logo, capa e dados de contato da loja.",
        href: tenantSlug
          ? withTenantSlug(tenantSlug, "/configuracoes/mini-vendor/editar")
          : "/configuracoes/mini-vendor/editar",
        Icon: Pencil,
        accentClass:
          "border-blue-500/30 bg-blue-500/10 text-blue-300 shadow-blue-500/10",
      },
      {
        title: "Criar e editar produtos",
        description:
          "Carrega so o catalogo da lojinha e continua liberado mesmo enquanto o cadastro estiver pendente.",
        href: tenantSlug
          ? withTenantSlug(tenantSlug, "/configuracoes/mini-vendor/produtos")
          : "/configuracoes/mini-vendor/produtos",
        Icon: Package,
        accentClass:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 shadow-emerald-500/10",
      },
      {
        title: "Pedidos pendentes",
        description:
          "Mostra somente a fila que ainda precisa de aprovacao, sem misturar com o historico.",
        href: tenantSlug
          ? withTenantSlug(tenantSlug, "/configuracoes/mini-vendor/pedidos-pendentes")
          : "/configuracoes/mini-vendor/pedidos-pendentes",
        Icon: Clock3,
        accentClass:
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-300 shadow-yellow-500/10",
      },
      {
        title: "Pedidos aprovados",
        description:
          "Historico separado para conferir somente os pagamentos que ja foram confirmados.",
        href: tenantSlug
          ? withTenantSlug(tenantSlug, "/configuracoes/mini-vendor/pedidos-aprovados")
          : "/configuracoes/mini-vendor/pedidos-aprovados",
        Icon: CheckCircle2,
        accentClass:
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-300 shadow-cyan-500/10",
      },
    ],
    [tenantSlug]
  );

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const cleanTenantId = tenantId.trim();
        const cleanUserId = user?.uid?.trim() || "";
        if (!cleanTenantId || !cleanUserId) {
          if (mounted) setProfile(null);
          return;
        }

        const vendorProfile = await fetchCurrentMiniVendorProfile({
          tenantId: cleanTenantId,
          userId: cleanUserId,
          forceRefresh: false,
        });
        if (mounted) setProfile(vendorProfile);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar mini vendor.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [addToast, tenantId, user?.uid]);

  return (
    <MiniVendorShell
      title="Mini Vendor"
      subtitle="Abra cada area em pagina propria para gastar menos consultas e manter o cadastro organizado."
      backPath="/configuracoes"
    >
      {!canUseArea ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
          Entre em uma atletica valida para usar a area mini vendor.
        </section>
      ) : loading ? (
        <section className="flex min-h-[240px] items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
          <Loader2 className="animate-spin text-blue-400" />
        </section>
      ) : (
        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-start gap-4">
              <div className="flex items-start gap-4">
                <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-zinc-700 bg-black">
                  <Image
                    src={profile?.logoUrl || tenantLogoUrl || "/logo.png"}
                    alt={profile?.storeName || "Mini vendor"}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    Visao Geral
                  </p>
                  <h2 className="mt-1 text-xl font-black uppercase text-white">
                    {profile?.storeName || "Sua loja mini vendor"}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-zinc-400">
                    {profile?.description ||
                      "Cadastre os dados da empresa, depois publique produtos e acompanhe os pedidos em telas separadas."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase ${getVendorStatusClass(profile?.status)}`}
                    >
                      {getVendorStatusLabel(profile?.status)}
                    </span>
                    <span className="inline-flex rounded-full border border-zinc-700 bg-black/30 px-3 py-1 text-[10px] font-black uppercase text-zinc-400">
                      Categoria publica: {profile?.storeName || "Minha Loja"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            {links.map((item) => {
              const Icon = item.Icon;
              return (
                <article
                  key={item.href}
                  className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)]"
                >
                  <div className={`inline-flex rounded-2xl border p-3 shadow-lg ${item.accentClass}`}>
                    <Icon size={18} />
                  </div>
                  <h3 className="mt-5 text-lg font-black uppercase text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{item.description}</p>
                  <Link
                    href={item.href}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black/30 px-4 py-3 text-xs font-black uppercase text-white hover:border-zinc-500 hover:bg-black/50"
                  >
                    Abrir pagina
                    <ChevronRight size={14} />
                  </Link>
                </article>
              );
            })}
          </div>

          {!profile ? (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-400">
              Nenhum cadastro encontrado ainda. Comece pela pagina de edicao da empresa.
            </section>
          ) : (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="flex items-center gap-2 text-xs font-black uppercase text-zinc-300">
                <Store size={14} />
                Resumo rapido
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <article className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    Loja
                  </p>
                  <p className="mt-2 text-sm font-bold text-white">{profile.storeName || "-"}</p>
                </article>
                <article className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    Instagram
                  </p>
                  <p className="mt-2 text-sm font-bold text-white">
                    {profile.instagramEnabled ? profile.instagram || "-" : "Desligado"}
                  </p>
                </article>
                <article className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    WhatsApp
                  </p>
                  <p className="mt-2 text-sm font-bold text-white">
                    {profile.whatsappEnabled ? profile.whatsapp || "-" : "Desligado"}
                  </p>
                </article>
              </div>
            </section>
          )}
        </div>
      )}
    </MiniVendorShell>
  );
}
