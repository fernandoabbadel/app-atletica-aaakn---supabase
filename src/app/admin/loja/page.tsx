"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MessageSquare, Package, Plus, Save, ShoppingBag, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { logActivity } from "@/lib/logger";
import { withTenantSlug } from "@/lib/tenantRouting";
import { fetchFinanceiroConfig, saveFinanceiroConfig } from "@/lib/eventsService";
import {
  hasValidPhoneLength,
  normalizePhoneInput,
  PHONE_MAX_LENGTH,
  PIX_BANK_MAX_LENGTH,
  PIX_HOLDER_MAX_LENGTH,
  PIX_KEY_MAX_LENGTH,
} from "@/utils/contactFields";

const menuItems = [
  {
    href: "/admin/loja/categorias",
    title: "Categorias",
    description: "Pagina propria para criar, editar e revisar as categorias",
    icon: Plus,
    color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
  },
  {
    href: "/admin/loja/produtos",
    title: "Produtos",
    description: "Catalogo admin com leitura dedicada",
    icon: Package,
    color: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  },
  {
    href: "/admin/loja/produtos-desativados",
    title: "Desativados",
    description: "Historico dos produtos fora do ar com reativacao segura",
    icon: Package,
    color: "text-red-400 border-red-500/30 bg-red-500/10",
  },
  {
    href: "/admin/loja/pedidos-pendentes",
    title: "Pedidos Pendentes",
    description: "Aprovacao separada para evitar bundle pesado",
    icon: ShoppingBag,
    color: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  },
  {
    href: "/admin/loja/review",
    title: "Reviews",
    description: "Fila de avaliacoes moderada por pagina",
    icon: MessageSquare,
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  },
] as const;

export default function AdminLojaMenuPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const adminHomeHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin") : "/admin";
  const categoryHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/loja/categorias")
    : "/admin/loja/categorias";
  const newProductHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/loja/produtos?action=new")
    : "/admin/loja/produtos?action=new";
  const [loadingFinanceiro, setLoadingFinanceiro] = useState(true);
  const [savingFinanceiro, setSavingFinanceiro] = useState(false);
  const [financeiroForm, setFinanceiroForm] = useState({
    chave: "",
    banco: "",
    titular: "",
    whatsapp: "",
  });

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const row = await fetchFinanceiroConfig({
          forceRefresh: true,
          tenantId: activeTenantId || undefined,
        });
        if (!mounted) return;
        setFinanceiroForm({
          chave: typeof row?.chave === "string" ? row.chave : "",
          banco: typeof row?.banco === "string" ? row.banco : "",
          titular: typeof row?.titular === "string" ? row.titular : "",
          whatsapp: typeof row?.whatsapp === "string" ? row.whatsapp : "",
        });
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar dados do PIX da loja.", "error");
      } finally {
        if (mounted) setLoadingFinanceiro(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, addToast]);

  const handleSaveFinanceiro = async () => {
    if (savingFinanceiro) return;
    const chave = financeiroForm.chave.trim();
    const banco = financeiroForm.banco.trim();
    const titular = financeiroForm.titular.trim();
    const whatsapp = financeiroForm.whatsapp.trim();

    if (!chave || !banco || !titular) {
      addToast("Preencha chave PIX, banco e titular.", "error");
      return;
    }
    if (whatsapp && !hasValidPhoneLength(whatsapp)) {
      addToast("Informe um WhatsApp valido com DDI e somente numeros.", "error");
      return;
    }

    try {
      setSavingFinanceiro(true);
      await saveFinanceiroConfig({
        chave,
        banco,
        titular,
        whatsapp,
      }, { tenantId: activeTenantId || undefined });
      if (user?.uid) {
        await logActivity(
          user.uid,
          user.nome || "Admin",
          "UPDATE",
          "Loja/Financeiro",
          "Atualizou PIX/WhatsApp da confirmacao de compra"
        ).catch(() => {});
      }
      addToast("Dados financeiros da loja atualizados.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar dados do PIX da loja.", "error");
    } finally {
      setSavingFinanceiro(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={adminHomeHref}
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Admin Loja</h1>
              <p className="text-[11px] text-zinc-500 font-bold">Menu leve com modulos separados</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={categoryHref}
              className="inline-flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-blue-300 hover:bg-blue-500/20"
            >
              <Plus size={14} />
              Categoria
            </Link>
            <Link
              href={newProductHref}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-emerald-300 hover:bg-emerald-500/20"
            >
              <Plus size={14} />
              Novo Produto
            </Link>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto">
        <section className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-black uppercase flex items-center gap-2">
                <Wallet size={14} className="text-emerald-400" />
                PIX / Comprovante da Loja
              </h2>
              <p className="mt-1 text-[11px] text-zinc-500">
                Esses dados aparecem na sequencia de confirmacao do pedido da loja e em Meus Pedidos.
              </p>
            </div>
            <button
              onClick={() => void handleSaveFinanceiro()}
              disabled={loadingFinanceiro || savingFinanceiro}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
            >
              {savingFinanceiro ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {savingFinanceiro ? "Salvando..." : "Salvar PIX"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={financeiroForm.chave}
              maxLength={PIX_KEY_MAX_LENGTH}
              onChange={(e) =>
                setFinanceiroForm((prev) => ({
                  ...prev,
                  chave: e.target.value.slice(0, PIX_KEY_MAX_LENGTH),
                }))
              }
              placeholder="Chave PIX (email/CNPJ/telefone/aleatoria)"
              className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              disabled={loadingFinanceiro}
            />
            <input
              value={financeiroForm.banco}
              maxLength={PIX_BANK_MAX_LENGTH}
              onChange={(e) =>
                setFinanceiroForm((prev) => ({
                  ...prev,
                  banco: e.target.value.slice(0, PIX_BANK_MAX_LENGTH),
                }))
              }
              placeholder="Banco"
              className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              disabled={loadingFinanceiro}
            />
            <input
              value={financeiroForm.titular}
              maxLength={PIX_HOLDER_MAX_LENGTH}
              onChange={(e) =>
                setFinanceiroForm((prev) => ({
                  ...prev,
                  titular: e.target.value.slice(0, PIX_HOLDER_MAX_LENGTH),
                }))
              }
              placeholder="Nome do titular"
              className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              disabled={loadingFinanceiro}
            />
            <input
              value={financeiroForm.whatsapp}
              maxLength={PHONE_MAX_LENGTH}
              inputMode="numeric"
              onChange={(e) =>
                setFinanceiroForm((prev) => ({
                  ...prev,
                  whatsapp: normalizePhoneInput(e.target.value),
                }))
              }
              placeholder="WhatsApp para enviar comprovante (somente numero com DDI)"
              className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              disabled={loadingFinanceiro}
            />
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={tenantSlug ? withTenantSlug(tenantSlug, item.href) : item.href}
                className="block bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-600 transition"
              >
                <div className={`w-11 h-11 rounded-xl border flex items-center justify-center ${item.color}`}>
                  <Icon size={18} />
                </div>
                <h2 className="mt-4 text-sm font-black uppercase">{item.title}</h2>
                <p className="mt-2 text-xs text-zinc-400">{item.description}</p>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
