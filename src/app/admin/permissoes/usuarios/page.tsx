"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Save,
  Search,
  Shield,
  Users,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { logActivity } from "@/lib/logger";
import { isPermissionError } from "@/lib/backendErrors";
import {
  fetchAdminUsersPage,
  setAdminUserTurmaLeader,
  type AdminUserListItem,
} from "@/lib/adminUsersService";
import { updatePermissionUserRole } from "@/lib/adminSecurityService";
import { canManageTenant, isPlatformMaster, resolveEffectiveAccessRole } from "@/lib/roles";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";

const PAGE_SIZE = 20;

const ROLES = [
  { id: "master_tenant", label: "Master Tenant" },
  { id: "admin_geral", label: "Admin Geral" },
  { id: "admin_gestor", label: "Gestor" },
  { id: "admin_treino", label: "Adm Treino" },
  { id: "vendas", label: "Vendas" },
  { id: "treinador", label: "Coach" },
  { id: "empresa", label: "Empresa" },
  { id: "mini_vendor", label: "Mini Vendor" },
  { id: "user", label: "Membro" },
  { id: "visitante", label: "Visitante" },
];

const USER_LETTER_FILTERS = [
  { id: "AF", label: "A-F", letters: ["A", "B", "C", "D", "E", "F"] },
  { id: "GK", label: "G-K", letters: ["G", "H", "I", "J", "K"] },
  { id: "LQ", label: "L-Q", letters: ["L", "M", "N", "O", "P", "Q"] },
  { id: "RZ", label: "R-Z", letters: ["R", "S", "T", "U", "V", "W", "X", "Y", "Z"] },
  { id: "all", label: "Todos", letters: [] },
];

type UserLetterFilterId = (typeof USER_LETTER_FILTERS)[number]["id"];

const statusLabel: Record<AdminUserListItem["status"], string> = {
  ativo: "Ativo",
  inadimplente: "Inadimplente",
  pendente: "Pendente",
  bloqueado: "Bloqueado",
};

const statusClass: Record<AdminUserListItem["status"], string> = {
  ativo: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  inadimplente: "bg-red-500/10 text-red-400 border-red-500/30",
  pendente: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  bloqueado: "bg-zinc-700/20 text-zinc-300 border-zinc-600/40",
};

const mergeUniqueUsers = (
  current: AdminUserListItem[],
  next: AdminUserListItem[]
): AdminUserListItem[] => {
  if (!next.length) return current;

  const known = new Set(current.map((row) => row.id));
  const merged = [...current];

  next.forEach((row) => {
    if (known.has(row.id)) return;
    known.add(row.id);
    merged.push(row);
  });

  return merged;
};

const normalizeRoleValue = (value?: string | null): string => {
  const role = (value || "visitante").trim().toLowerCase();
  return role === "guest" || !role ? "visitante" : role;
};

const roleLabel = (roleId: string): string =>
  ROLES.find((role) => role.id === roleId)?.label ?? roleId.toUpperCase();

export default function AdminPermissoesUsuariosPage() {
  const { user, loading: authLoading } = useAuth();
  const { tenantId: activeTenantId, tenantName, tenantSigla, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const router = useRouter();

  const [rows, setRows] = useState<AdminUserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeLetterFilter, setActiveLetterFilter] = useState<UserLetterFilterId>("AF");
  const [pendingRoles, setPendingRoles] = useState<Record<string, string>>({});
  const [savingRoles, setSavingRoles] = useState<Set<string>>(new Set());

  const canManageRoles = canManageTenant(user);
  const effectiveAccessRole = resolveEffectiveAccessRole(user);
  const canAssignTurmaLeader =
    isPlatformMaster(user) || effectiveAccessRole === "master_tenant";
  const selectedLetterFilter =
    USER_LETTER_FILTERS.find((filter) => filter.id === activeLetterFilter) ??
    USER_LETTER_FILTERS[0];
  const activeSearchTerm = searchTerm.trim();
  const pendingRolesCount = Object.keys(pendingRoles).length;
  const savingAnyRole = savingRoles.size > 0;

  const loadUsers = useCallback(
    async (options?: { reset?: boolean; cursorId?: string | null }) => {
      const reset = options?.reset ?? false;
      const cursorId = options?.cursorId ?? null;

      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        const page = await fetchAdminUsersPage({
          pageSize: PAGE_SIZE,
          cursorId: reset ? null : cursorId,
          forceRefresh: reset,
          tenantId: activeTenantId || undefined,
          searchTerm: activeSearchTerm || undefined,
          letters: activeSearchTerm ? undefined : selectedLetterFilter.letters,
        });

        if (reset) setRows(page.users);
        else setRows((prev) => mergeUniqueUsers(prev, page.users));

        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      } catch (error: unknown) {
        if (isPermissionError(error)) {
          addToast("Sem permissão para listar usuários.", "error");
          router.push("/sem-permissao");
          return;
        }
        console.error(error);
        addToast("Erro ao carregar usuários.", "error");
      } finally {
        if (reset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [activeSearchTerm, activeTenantId, addToast, router, selectedLetterFilter.letters]
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchTerm(searchInput);
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    if (authLoading) return;

    if (!canManageRoles) {
      setLoading(false);
      router.push("/dashboard");
      return;
    }

    if (!activeTenantId) {
      setLoading(false);
      addToast("Selecione um tenant antes de editar cargos.", "error");
      router.push(tenantSlug ? withTenantSlug(tenantSlug, "/admin") : "/admin");
      return;
    }

    void loadUsers({ reset: true });
  }, [activeTenantId, authLoading, canManageRoles, router, loadUsers, addToast, tenantSlug]);

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    await loadUsers({ reset: false, cursorId: nextCursor });
  };

  const handleSelectRole = (targetUserId: string, currentRole: string, nextRole: string) => {
    const normalizedNextRole = normalizeRoleValue(nextRole);
    const normalizedCurrentRole = normalizeRoleValue(currentRole);
    setPendingRoles((prev) => {
      const next = { ...prev };
      if (normalizedNextRole === normalizedCurrentRole) {
        delete next[targetUserId];
      } else {
        next[targetUserId] = normalizedNextRole;
      }
      return next;
    });
  };

  const handleSaveRole = async (targetUserId: string, roleOverride?: string) => {
    const role = normalizeRoleValue(roleOverride ?? pendingRoles[targetUserId]);
    if (!role || (!pendingRoles[targetUserId] && !roleOverride)) return;

    setSavingRoles((prev) => new Set(prev).add(targetUserId));
    try {
      await updatePermissionUserRole({
        targetUserId,
        role,
        tenantId: activeTenantId || undefined,
      });

      setRows((prev) =>
        prev.map((entry) =>
          entry.id === targetUserId ? { ...entry, role } : entry
        )
      );
      setPendingRoles((prev) => {
        const next = { ...prev };
        delete next[targetUserId];
        return next;
      });

      const adminName =
        typeof user?.displayName === "string" ? user.displayName : "Admin Master";

      await logActivity(
        user?.uid || "sistema",
        adminName,
        "UPDATE",
        "Permissoes - Cargos",
        `Alterou cargo do usuário ${targetUserId} para ${role}`
      );

      addToast(`Cargo salvo como ${roleLabel(role)}.`, "success");
    } catch (error: unknown) {
      if (isPermissionError(error)) {
        addToast("Sem permissão para alterar cargo.", "error");
        return;
      }
      console.error(error);
      addToast("Erro ao atualizar cargo.", "error");
    } finally {
      setSavingRoles((prev) => {
        const next = new Set(prev);
        next.delete(targetUserId);
        return next;
      });
    }
  };

  const handleSaveAllRoles = async () => {
    const entries = Object.entries(pendingRoles);
    if (!entries.length) return;
    for (const [targetUserId, role] of entries) {
      await handleSaveRole(targetUserId, role);
    }
  };

  const handleToggleTurmaLeader = async (
    targetUserId: string,
    nextValue: boolean
  ) => {
    try {
      await setAdminUserTurmaLeader({
        userId: targetUserId,
        enabled: nextValue,
      });

      setRows((prev) =>
        prev.map((entry) =>
          entry.id === targetUserId ? { ...entry, isTurmaLeader: nextValue } : entry
        )
      );

      addToast(
        nextValue
          ? "Usuário marcado como líder de turma."
          : "Liderança de turma removida.",
        "success"
      );
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar liderança de turma.", "error");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500 w-10 h-10" />
      </div>
    );
  }

  if (!canManageRoles) return null;

  const permissionsHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/permissoes")
    : "/admin/permissoes";
  const usersHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin/usuarios") : "/admin/usuarios";

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={permissionsHref}
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                <Shield className="text-cyan-400" size={18} /> Cargos de Acesso
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold">
                {tenantSigla || tenantName || "Tenant atual"} • paginação por grupos
              </p>
            </div>
          </div>

          <Link
            href={usersHref}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-black uppercase border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 transition"
          >
            <Users size={14} /> Status Completo
          </Link>
        </div>
      </header>

      <main className="px-6 py-6 space-y-4">
        <section className="sticky top-24 z-20 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg">
          <div className="flex items-center gap-2">
            <Search className="text-zinc-500" size={18} />
            <input
              type="text"
              placeholder="Buscar usuário por nome, email, turma ou matrícula..."
              className="bg-transparent outline-none text-sm text-white w-full placeholder:text-zinc-600"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-3 border-t border-zinc-800 pt-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              {USER_LETTER_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setActiveLetterFilter(filter.id)}
                  className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase transition ${
                    activeLetterFilter === filter.id
                      ? "border-cyan-400 bg-cyan-400 text-black"
                      : "border-zinc-700 bg-black/40 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                {pendingRolesCount > 0
                  ? pendingRolesCount === 1
                    ? "1 alteração pendente."
                    : `${pendingRolesCount} alterações pendentes.`
                  : activeSearchTerm
                    ? "Busca em todos os usuários do tenant."
                    : "Escolha o cargo e clique em salvar."}
              </p>
              <button
                type="button"
                onClick={() => void handleSaveAllRoles()}
                disabled={pendingRolesCount === 0 || savingAnyRole}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-emerald-200 transition hover:bg-emerald-500 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAnyRole ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar alterações
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-3">
          {rows.length > 0 ? (
            rows.map((entry) => {
              const currentRole = normalizeRoleValue(entry.role);
              const selectedRole = pendingRoles[entry.id] ?? currentRole;
              const hasPendingRole = pendingRoles[entry.id] !== undefined;
              const savingRole = savingRoles.has(entry.id);
              const roleLocked = entry.id === user?.uid || !activeTenantId;

              return (
              <div
                key={entry.id}
                className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 group hover:border-zinc-700 transition"
              >
                <div className="w-full md:w-auto">
                  <p className="font-bold text-sm text-white flex items-center gap-2">
                    {entry.nome || "Sem Nome"}
                    {entry.id === user?.uid && (
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-500 px-2 rounded-full border border-emerald-500/30">
                        VOCÊ
                      </span>
                    )}
                    {entry.isTurmaLeader && (
                      <span className="text-[9px] rounded-full border border-cyan-500/30 bg-cyan-500/15 px-2 text-cyan-300">
                        LÍDER DA TURMA
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500">{entry.email || "sem email"}</p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Turma: {entry.turma || "---"} - Matrícula: {entry.matricula || "---"}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-1 rounded border text-[10px] uppercase font-black ${statusClass[entry.status]}`}
                  >
                    {statusLabel[entry.status]}
                  </span>

                  <select
                    value={selectedRole}
                    onChange={(event) => handleSelectRole(entry.id, currentRole, event.target.value)}
                    className={`bg-zinc-900 text-white text-xs rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer uppercase font-bold border ${
                      hasPendingRole ? "border-amber-400" : "border-zinc-700"
                    }`}
                    disabled={roleLocked || savingRole}
                  >
                    {ROLES.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => void handleSaveRole(entry.id)}
                    disabled={!hasPendingRole || roleLocked || savingRole}
                    className="inline-flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-black uppercase text-emerald-200 transition hover:bg-emerald-500 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingRole ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Salvar
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void handleToggleTurmaLeader(entry.id, !entry.isTurmaLeader)
                    }
                    disabled={
                      !canAssignTurmaLeader ||
                      entry.id === user?.uid ||
                      !activeTenantId
                    }
                    className={`rounded px-3 py-1.5 text-[10px] font-black uppercase border transition ${
                      entry.isTurmaLeader
                        ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {entry.isTurmaLeader ? "Remover líder" : "Virar líder"}
                  </button>
                </div>
              </div>
              );
            })
          ) : (
            <div className="text-center py-12 text-zinc-500 bg-zinc-900/40 border border-zinc-800 rounded-xl">
              Nenhum usuário encontrado.
            </div>
          )}
        </section>

        {!loading && hasMore && (
          <button
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            className="w-full py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase tracking-wide hover:bg-zinc-800 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loadingMore ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Carregando
              </>
            ) : (
              <>
                <ChevronDown size={15} /> Carregar mais
              </>
            )}
          </button>
        )}
      </main>
    </div>
  );
}
