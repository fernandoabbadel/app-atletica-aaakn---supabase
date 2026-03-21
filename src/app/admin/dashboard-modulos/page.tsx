"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, LayoutDashboard, Save } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  TENANT_APP_MODULE_DEFINITIONS,
  createDefaultTenantAppModulesConfig,
  fetchTenantAppModulesConfig,
  isTenantAdminProfileAppModuleVisible,
  saveTenantAppModulesConfig,
  type TenantAppModulesConfig,
} from "@/lib/tenantAppModulesService";
import {
  createDefaultTenantAdminSidebarProfilesConfig,
  fetchTenantAdminSidebarProfileAssignment,
  fetchTenantAdminSidebarProfilesConfig,
  resolveTenantAdminSidebarProfile,
  type TenantAdminSidebarProfileKey,
  type TenantAdminSidebarProfilesConfig,
} from "@/lib/tenantAdminSidebarService";

const GROUP_LABELS = {
  base: "Base",
  conteudo: "Conteudo",
  atleta: "Area do Atleta",
  info: "Central de Info",
} as const;

const GROUP_ORDER = ["base", "conteudo", "atleta", "info"] as const;

export default function AdminDashboardModulesPage() {
  const { addToast } = useToast();
  const { tenantId: activeTenantId, tenantName, tenantSigla, tenantSlug } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<TenantAppModulesConfig>(
    createDefaultTenantAppModulesConfig
  );
  const [profilesConfig, setProfilesConfig] = useState<TenantAdminSidebarProfilesConfig>(
    createDefaultTenantAdminSidebarProfilesConfig
  );
  const [profileKey, setProfileKey] = useState<TenantAdminSidebarProfileKey>("A");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!activeTenantId) {
        if (mounted) {
          setConfig(createDefaultTenantAppModulesConfig());
          setProfilesConfig(createDefaultTenantAdminSidebarProfilesConfig());
          setProfileKey("A");
          setLoading(false);
        }
        return;
      }

      try {
        const nextProfilesConfig = await fetchTenantAdminSidebarProfilesConfig({
          forceRefresh: true,
        });
        const [nextConfig, nextProfileKey] = await Promise.all([
          fetchTenantAppModulesConfig({
            tenantId: activeTenantId,
            forceRefresh: true,
          }),
          fetchTenantAdminSidebarProfileAssignment({
            tenantId: activeTenantId,
            tenantSlug,
            forceRefresh: true,
            profilesConfig: nextProfilesConfig,
          }),
        ]);
        if (mounted) {
          setProfilesConfig(nextProfilesConfig);
          setProfileKey(nextProfileKey);
          setConfig(nextConfig);
        }
      } catch (error: unknown) {
        console.error(error);
        if (mounted) {
          setConfig(createDefaultTenantAppModulesConfig());
          setProfilesConfig(createDefaultTenantAdminSidebarProfilesConfig());
          setProfileKey("A");
          addToast("Erro ao carregar modulos da tenant.", "error");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, addToast, tenantSlug]);

  const activeProfile = useMemo(
    () => resolveTenantAdminSidebarProfile(profilesConfig, profileKey),
    [profileKey, profilesConfig]
  );

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        label: GROUP_LABELS[group],
        items: TENANT_APP_MODULE_DEFINITIONS.filter(
          (definition) =>
            definition.group === group &&
            isTenantAdminProfileAppModuleVisible(profilesConfig, profileKey, definition.key)
        ),
      })).filter((entry) => entry.items.length > 0),
    [profileKey, profilesConfig]
  );

  const handleToggle = (key: string) => {
    setConfig((prev) => ({
      modules: {
        ...prev.modules,
        [key]: !prev.modules[key],
      },
    }));
  };

  const handleSave = async () => {
    if (!activeTenantId) {
      addToast("Selecione uma tenant valida antes de salvar.", "error");
      return;
    }

    try {
      setSaving(true);
      await saveTenantAppModulesConfig(config, { tenantId: activeTenantId });
      addToast("Modulos visiveis atualizados para esta tenant.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar modulos da tenant.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight inline-flex items-center gap-2">
                <LayoutDashboard size={18} className="text-brand-accent" />
                Modulos do App
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold">
                Dashboard e lateral de {tenantSigla || tenantName || "tenant"}
              </p>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || loading || !activeTenantId}
            className="brand-button-solid px-4 py-2 disabled:opacity-60"
          >
            <Save size={14} />
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-6">
        {!activeTenantId ? (
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
            Nenhuma tenant ativa foi encontrada para editar os modulos.
          </div>
        ) : (
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
            Perfil do master ativo para esta tenant:{" "}
            <span className="font-black uppercase text-white">{activeProfile.name}</span>.
            Itens ocultos pelo perfil nao aparecem aqui e continuam bloqueados para os usuarios.
          </div>
        )}

        {groups.map((group) => (
          <section key={group.group} className="rounded-3xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="border-b border-zinc-800 bg-black/20 px-5 py-4">
              <h2 className="text-sm font-black uppercase tracking-widest text-zinc-300">
                {group.label}
              </h2>
            </div>
            <div className="divide-y divide-zinc-800">
              {group.items.map((item) => {
                const enabled = config.modules[item.key] !== false;
                return (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4 hover:bg-zinc-800/40 transition"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{item.label}</span>
                        <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[9px] font-black uppercase text-zinc-500">
                          {item.surfaces.join(" / ")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">{item.description}</p>
                      {item.route ? (
                        <p className="mt-2 text-[11px] font-mono text-brand-accent">{item.route}</p>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggle(item.key)}
                      className={`inline-flex min-w-[96px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-black uppercase transition ${
                        enabled
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-zinc-700 bg-zinc-950 text-zinc-500"
                      }`}
                    >
                      {enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                      {enabled ? "Visivel" : "Oculto"}
                    </button>
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
