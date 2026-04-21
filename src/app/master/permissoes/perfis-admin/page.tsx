"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckSquare,
  Loader2,
  PanelLeft,
  Plus,
  Save,
  Shield,
  Users,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { isPlatformMaster } from "@/lib/roles";
import {
  fetchManageableTenants,
  type TenantSummary,
} from "@/lib/tenantService";
import {
  createDefaultTenantAdminSidebarProfilesConfig,
  fetchTenantAdminSidebarProfileAssignment,
  fetchTenantAdminSidebarProfilesConfig,
  TENANT_ADMIN_SIDEBAR_GROUP_ORDER,
  TENANT_ADMIN_SIDEBAR_ITEMS,
  saveTenantAdminSidebarProfileAssignment,
  saveTenantAdminSidebarProfilesConfig,
  type TenantAdminSidebarItemKey,
  type TenantAdminSidebarProfileDefinition,
  type TenantAdminSidebarProfileKey,
  type TenantAdminSidebarProfilesConfig,
} from "@/lib/tenantAdminSidebarService";
import {
  clearEffectiveTenantAppModulesCache,
  isTenantAdminProfileAppModuleVisible,
  TENANT_APP_MODULE_DEFINITIONS,
  type TenantAppModuleKey,
} from "@/lib/tenantAppModulesService";
import { withTenantSlug } from "@/lib/tenantRouting";

const GROUP_LABELS: Record<(typeof TENANT_ADMIN_SIDEBAR_GROUP_ORDER)[number], string> = {
  Base: "Base",
  Comercial: "Comercial",
  Conteúdo: "Conteúdo",
  Esportes: "Esportes",
  Governança: "Governança",
  Plataforma: "Plataforma",
};

const APP_GROUP_ORDER = ["base", "conteudo", "atleta", "info"] as const;
const APP_GROUP_LABELS: Record<(typeof APP_GROUP_ORDER)[number], string> = {
  base: "Base",
  conteudo: "Conteúdo",
  atleta: "Área do Atleta",
  info: "Central de Info",
};

const buildCustomProfileDefinition = (
  key: TenantAdminSidebarProfileKey,
  index: number
): TenantAdminSidebarProfileDefinition => ({
  name: `Perfil ${index}`,
  description: `Perfil personalizado ${key} para combinar painel admin e app do usuário.`,
  adminItems: {},
  appModules: {},
});

const resolveOrderedProfileKeys = (
  config: TenantAdminSidebarProfilesConfig
): TenantAdminSidebarProfileKey[] => {
  const keys = new Set<string>(config.order);
  Object.keys(config.profiles).forEach((key) => keys.add(key));
  return Array.from(keys).filter((key) => Boolean(config.profiles[key]));
};

export default function MasterAdminSidebarProfilesPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [config, setConfig] = useState<TenantAdminSidebarProfilesConfig>(
    createDefaultTenantAdminSidebarProfilesConfig
  );
  const [assignments, setAssignments] = useState<
    Record<string, TenantAdminSidebarProfileKey>
  >({});

  const canAccess = isPlatformMaster(user);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!canAccess) {
        if (mounted) setLoading(false);
        return;
      }

      try {
        const [tenantRows, profilesConfig] = await Promise.all([
          fetchManageableTenants({ includeAll: true }),
          fetchTenantAdminSidebarProfilesConfig({ forceRefresh: true }),
        ]);

        const sortedTenants = [...tenantRows].sort((left, right) =>
          left.nome.localeCompare(right.nome, "pt-BR")
        );

        const assignmentEntries = await Promise.all(
          sortedTenants.map(async (tenant) => {
            const profileKey = await fetchTenantAdminSidebarProfileAssignment({
              tenantId: tenant.id,
              tenantSlug: tenant.slug,
              forceRefresh: true,
              profilesConfig,
            });
            return [tenant.id, profileKey] as const;
          })
        );

        if (!mounted) return;

        setTenants(sortedTenants);
        setConfig(profilesConfig);
        setAssignments(Object.fromEntries(assignmentEntries));
      } catch (error: unknown) {
        console.error(error);
        if (mounted) {
          addToast("Erro ao carregar perfis do menu admin.", "error");
        }
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
  }, [addToast, canAccess]);

  const profileKeys = useMemo(() => resolveOrderedProfileKeys(config), [config]);
  const profileEntries = useMemo(
    () =>
      profileKeys.map((key) => ({
        key,
        profile: config.profiles[key],
      })),
    [config.profiles, profileKeys]
  );

  const groupedItems = useMemo(
    () =>
      TENANT_ADMIN_SIDEBAR_GROUP_ORDER.map((group) => ({
        group,
        label: GROUP_LABELS[group],
        items: TENANT_ADMIN_SIDEBAR_ITEMS.filter((item) => item.group === group),
      })).filter((entry) => entry.items.length > 0),
    []
  );

  const groupedAppModules = useMemo(
    () =>
      APP_GROUP_ORDER.map((group) => ({
        group,
        label: APP_GROUP_LABELS[group],
        items: TENANT_APP_MODULE_DEFINITIONS.filter((item) => item.group === group),
      })).filter((entry) => entry.items.length > 0),
    []
  );

  const handleToggleProfileItem = (
    profileKey: TenantAdminSidebarProfileKey,
    itemKey: TenantAdminSidebarItemKey
  ) => {
    setConfig((prev) => {
      const profile = prev.profiles[profileKey];
      if (!profile) return prev;
      const enabled = profile.adminItems[itemKey] !== false;
      return {
        ...prev,
        profiles: {
          ...prev.profiles,
          [profileKey]: {
            ...profile,
            adminItems: {
              ...profile.adminItems,
              [itemKey]: !enabled,
            },
          },
        },
      };
    });
  };

  const handleToggleProfileAppModule = (
    profileKey: TenantAdminSidebarProfileKey,
    moduleKey: TenantAppModuleKey
  ) => {
    setConfig((prev) => {
      const profile = prev.profiles[profileKey];
      if (!profile) return prev;
      const enabled = isTenantAdminProfileAppModuleVisible(prev, profileKey, moduleKey);
      return {
        ...prev,
        profiles: {
          ...prev.profiles,
          [profileKey]: {
            ...profile,
            appModules: {
              ...profile.appModules,
              [moduleKey]: !enabled,
            },
          },
        },
      };
    });
  };

  const handleProfileNameChange = (
    profileKey: TenantAdminSidebarProfileKey,
    value: string
  ) => {
    setConfig((prev) => {
      const profile = prev.profiles[profileKey];
      if (!profile) return prev;
      return {
        ...prev,
        profiles: {
          ...prev.profiles,
          [profileKey]: {
            ...profile,
            name: value,
          },
        },
      };
    });
  };

  const handleCreateProfile = () => {
    setConfig((prev) => {
      let nextIndex = 3;
      let nextKey = `P${nextIndex}`;
      while (prev.profiles[nextKey]) {
        nextIndex += 1;
        nextKey = `P${nextIndex}`;
      }

      return {
        order: [...resolveOrderedProfileKeys(prev), nextKey],
        profiles: {
          ...prev.profiles,
          [nextKey]: buildCustomProfileDefinition(nextKey, nextIndex),
        },
      };
    });
  };

  const handleAssignmentChange = (
    tenantId: string,
    profileKey: TenantAdminSidebarProfileKey
  ) => {
    setAssignments((prev) => ({ ...prev, [tenantId]: profileKey }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await saveTenantAdminSidebarProfilesConfig(config);
      await Promise.all(
        tenants.map((tenant) =>
          saveTenantAdminSidebarProfileAssignment({
            tenantId: tenant.id,
            profileKey: assignments[tenant.id] || profileKeys[0] || "A",
          })
        )
      );
      clearEffectiveTenantAppModulesCache();
      addToast("Perfis do admin salvos.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar perfis do admin.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!canAccess) return null;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-red-300">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] pb-24 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/95 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/master/permissoes"
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight">
                <PanelLeft size={18} className="text-red-300" />
                Perfis do Admin
              </h1>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                Cada perfil controla painel admin e modulos do app da tenant
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreateProfile}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-cyan-500/15"
            >
              <Plus size={14} />
              Novo Perfil
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-red-100 transition hover:bg-red-500/15 disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Salvando..." : "Salvar tudo"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6">
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-start gap-3">
            <Shield size={18} className="mt-0.5 text-red-300" />
            <div className="space-y-1">
              <p className="text-sm font-black uppercase text-white">
                Como isso funciona
              </p>
              <p className="text-xs text-zinc-400">
                O perfil define o que a tenant pode ver no `tenant/admin` e quais modulos do app
                podem aparecer no `tenant/admin/dashboard-modulos`. Se um item for ocultado aqui,
                ele some da tenant, do menu do usuário e continua bloqueado por rota.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users size={16} className="text-red-300" />
            <h2 className="text-sm font-black uppercase text-white">Atribuição por atlética</h2>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tenants.map((tenant) => {
              const selectedProfile = assignments[tenant.id] || profileKeys[0] || "A";
              return (
                <article
                  key={tenant.id}
                  className="rounded-2xl border border-zinc-800 bg-black/30 p-4"
                >
                  <div className="mb-3">
                    <p className="text-sm font-black uppercase text-white">
                      {tenant.sigla} • {tenant.nome}
                    </p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                      /{tenant.slug}
                    </p>
                  </div>

                  <div className="grid gap-2">
                    {profileEntries.map(({ key, profile }) => {
                      const active = selectedProfile === key;
                      return (
                        <button
                          key={`${tenant.id}:${key}`}
                          type="button"
                          onClick={() => handleAssignmentChange(tenant.id, key)}
                          className={`rounded-xl border px-3 py-3 text-left transition ${
                            active
                              ? "border-red-500/40 bg-red-500/10 text-red-100"
                              : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:bg-zinc-900"
                          }`}
                        >
                          <p className="text-xs font-black uppercase">{profile.name}</p>
                          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                            Chave {key}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  <Link
                    href={withTenantSlug(tenant.slug, "/admin/dashboard-modulos")}
                    className="mt-3 inline-flex items-center rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200 transition hover:bg-cyan-500/15"
                  >
                    Modulos da Tenant
                  </Link>
                </article>
              );
            })}
          </div>
        </section>

        <div className="grid gap-6">
          {profileEntries.map(({ key, profile }) => (
            <section
              key={key}
              className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/50"
            >
              <div className="border-b border-zinc-800 bg-black/20 px-5 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                      Perfil {key}
                    </p>
                    <input
                      value={profile.name}
                      onChange={(event) => handleProfileNameChange(key, event.target.value)}
                      maxLength={50}
                      className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm font-black uppercase text-white outline-none transition focus:border-red-400"
                    />
                  </div>
                  <p className="max-w-xl text-xs text-zinc-400">
                    Esse nome aparece na atribuicao por tenant. Os itens abaixo definem o que a
                    atlética pode administrar no painel e no app.
                  </p>
                </div>
              </div>

              <div className="grid gap-6 p-5 xl:grid-cols-2">
                <section className="rounded-2xl border border-zinc-800 bg-black/25 overflow-hidden">
                  <div className="border-b border-zinc-800 bg-black/20 px-4 py-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-red-200">
                      Painel Admin
                    </p>
                  </div>
                  <div className="divide-y divide-zinc-800">
                    {groupedItems.map((group) => (
                      <div key={`${key}:${group.group}`} className="p-4">
                        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                          {group.label}
                        </p>

                        <div className="space-y-2">
                          {group.items.map((item) => {
                            const enabled = profile.adminItems[item.key] !== false;
                            return (
                              <label
                                key={`${key}:${item.key}`}
                                className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-zinc-800 bg-black/20 px-4 py-3 hover:border-zinc-700"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-white">{item.name}</p>
                                  <p className="mt-1 text-xs text-zinc-500">{item.description}</p>
                                  <p className="mt-2 text-[11px] font-mono text-red-200/70">
                                    {item.path}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleToggleProfileItem(key, item.key)}
                                  className={`inline-flex min-w-[110px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-black uppercase transition ${
                                    enabled
                                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                      : "border-zinc-700 bg-zinc-950 text-zinc-500"
                                  }`}
                                >
                                  <CheckSquare size={14} />
                                  {enabled ? "Liberada" : "Oculta"}
                                </button>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-zinc-800 bg-black/25 overflow-hidden">
                  <div className="border-b border-zinc-800 bg-black/20 px-4 py-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-200">
                      App do Usuário
                    </p>
                  </div>
                  <div className="divide-y divide-zinc-800">
                    {groupedAppModules.map((group) => (
                      <div key={`${key}:${group.group}`} className="p-4">
                        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                          {group.label}
                        </p>

                        <div className="space-y-2">
                          {group.items.map((item) => {
                            const enabled = isTenantAdminProfileAppModuleVisible(
                              config,
                              key,
                              item.key
                            );
                            return (
                              <label
                                key={`${key}:${item.key}`}
                                className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-zinc-800 bg-black/20 px-4 py-3 hover:border-zinc-700"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-white">{item.label}</p>
                                  <p className="mt-1 text-xs text-zinc-500">{item.description}</p>
                                  {item.route ? (
                                    <p className="mt-2 text-[11px] font-mono text-cyan-200/80">
                                      {item.route}
                                    </p>
                                  ) : null}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleToggleProfileAppModule(key, item.key)}
                                  className={`inline-flex min-w-[110px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-black uppercase transition ${
                                    enabled
                                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                      : "border-zinc-700 bg-zinc-950 text-zinc-500"
                                  }`}
                                >
                                  <CheckSquare size={14} />
                                  {enabled ? "Liberada" : "Oculta"}
                                </button>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
