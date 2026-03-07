"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { isPlatformMaster } from "@/lib/roles";
import {
  fetchManageableTenants,
  type TenantSummary,
} from "@/lib/tenantService";

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Nao foi possivel carregar a lista de tenants.";
};

export default function MasterTenantSwitcher() {
  const { user } = useAuth();
  const { tenantId, setMasterTenantOverride } = useTenantTheme();
  const { addToast } = useToast();
  const router = useRouter();

  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const canSelectTenant = isPlatformMaster(user);

  useEffect(() => {
    if (!canSelectTenant) {
      setTenants([]);
      setLoading(false);
      return;
    }

    let mounted = true;
    const loadTenants = async () => {
      try {
        const rows = await fetchManageableTenants({ includeAll: true });
        if (!mounted) return;
        setTenants(rows);
      } catch (error: unknown) {
        if (!mounted) return;
        addToast(extractErrorMessage(error), "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadTenants();
    return () => {
      mounted = false;
    };
  }, [addToast, canSelectTenant]);

  if (!canSelectTenant) return null;

  const handleChange = (nextTenantId: string) => {
    setMasterTenantOverride(nextTenantId);
    addToast(
      nextTenantId
        ? "Contexto master atualizado para o tenant selecionado."
        : "Modo global da plataforma restaurado.",
      "success"
    );
    router.push("/admin");
  };

  return (
    <div className="mb-4 rounded-xl border border-cyan-700/30 bg-cyan-950/20 p-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-cyan-200">
        <Building2 size={13} /> Contexto Master
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          <Loader2 size={13} className="animate-spin" /> Carregando tenants...
        </div>
      ) : (
        <>
          <select
            value={tenantId}
            onChange={(event) => handleChange(event.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-bold text-white"
          >
            <option value="">Modo global da plataforma</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.sigla} - {tenant.nome}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            {tenantId ? "Tenant selecionado para navegacao e admin." : "Sem tenant fixado."}
          </p>
        </>
      )}
    </div>
  );
}
