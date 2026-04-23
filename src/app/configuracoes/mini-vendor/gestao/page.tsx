"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ProductManagementAnalytics } from "@/components/ProductManagementAnalytics";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchCurrentMiniVendorProfile,
  fetchMiniVendorOrders,
  fetchMiniVendorProducts,
  type MiniVendorProfile,
} from "@/lib/miniVendorService";
import type { Row } from "@/lib/supabaseData";

import { MiniVendorShell } from "../_components/MiniVendorShell";

export default function MiniVendorGestaoPage() {
  const { user } = useAuth();
  const { tenantId } = useTenantTheme();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<MiniVendorProfile | null>(null);
  const [products, setProducts] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const cleanTenantId = tenantId.trim();
        const cleanUserId = user?.uid?.trim() || "";
        if (!cleanTenantId || !cleanUserId) {
          if (mounted) {
            setProfile(null);
            setProducts([]);
            setOrders([]);
          }
          return;
        }

        const vendorProfile = await fetchCurrentMiniVendorProfile({
          tenantId: cleanTenantId,
          userId: cleanUserId,
          forceRefresh: false,
        });
        if (!vendorProfile?.id) {
          if (mounted) {
            setProfile(vendorProfile);
            setProducts([]);
            setOrders([]);
          }
          return;
        }

        const [productRows, orderRows] = await Promise.all([
          fetchMiniVendorProducts({
            tenantId: cleanTenantId,
            sellerId: vendorProfile.id,
            maxResults: 200,
          }),
          fetchMiniVendorOrders({
            tenantId: cleanTenantId,
            sellerId: vendorProfile.id,
            limit: 50,
          }),
        ]);

        if (mounted) {
          setProfile(vendorProfile);
          setProducts(productRows);
          setOrders(orderRows);
        }
      } catch (error) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar a gestão do mini-vendor.", "error");
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
      title="Gestão da lojinha"
      subtitle="Receita, estoque, conversão, recompra e produtos parados só do seu mini-vendor."
      backPath="/configuracoes/mini-vendor"
    >
      {loading ? (
        <section className="flex min-h-[260px] items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
          <Loader2 className="animate-spin text-emerald-400" />
        </section>
      ) : !profile?.id ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm font-semibold text-zinc-400">
          Cadastre a lojinha antes de abrir a gestão.
        </section>
      ) : (
        <ProductManagementAnalytics
          products={products}
          orders={orders}
          title={profile.storeName || "Minha lojinha"}
          subtitle="Análises privadas da sua lojinha: sem comparar com atlética, ligas ou outros vendedores."
          allLabel="Todos os produtos da lojinha"
        />
      )}
    </MiniVendorShell>
  );
}
