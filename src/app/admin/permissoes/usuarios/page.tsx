"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
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
  type AdminUserListItem,
} from "@/lib/adminUsersService";
import { updatePermissionUserRole } from "@/lib/adminSecurityService";
import { canManageTenant } from "@/lib/roles";
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
  { id: "user", label: "Membro" },
  { id: "visitante", label: "Visitante" },
];

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
  const [searchTerm, setSearchTerm] = useState("");

  const canManageRoles = canManageTenant(user);

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
          forceRefresh: false,
          tenantId: activeTenantId || undefined,
        });

        if (reset) setRows(page.users);
        else setRows((prev) => mergeUniqueUsers(prev, page.users));

        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      } catch (error: unknown) {
        if (isPermissionError(error)) {
          addToast("Sem permissao para listar usuarios.", "error");
          router.push("/sem-permissao");
          return;
        }
        console.error(error);
        addToast("Erro ao carregar usuarios.", "error");
      } finally {
        if (reset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [activeTenantId, addToast, router]
  );

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

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      `${row.nome} ${row.email} ${row.matricula} ${row.turma}`
        .toLowerCase()
        .includes(term)
    );
  }, [rows, searchTerm]);

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    await loadUsers({ reset: false, cursorId: nextCursor });
  };

  const handleUpdateRole = async (targetUserId: string, role: string) => {
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

      const adminName =
        typeof user?.displayName === "string" ? user.displayName : "Admin Master";

      await logActivity(
        user?.uid || "sistema",
        adminName,
        "UPDATE",
        "Permissoes - Cargos",
        `Alterou cargo do usuario ${targetUserId} para ${role}`
      );

      addToast(`Cargo atualizado para ${role.toUpperCase()}.`, "success");
    } catch (error: unknown) {
      if (isPermissionError(error)) {
        addToast("Sem permissao para alterar cargo.", "error");
        return;
      }
      console.error(error);
      addToast("Erro ao atualizar cargo.", "error");
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
                {tenantSigla || tenantName || "Tenant atual"} • paginacao 20 em 20
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
        <section className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 flex items-center gap-2 sticky top-24 z-20 shadow-lg">
          <Search className="text-zinc-500" size={18} />
          <input
            type="text"
            placeholder="Buscar usuario por nome, email, turma ou matricula..."
            className="bg-transparent outline-none text-sm text-white w-full placeholder:text-zinc-600"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </section>

        <section className="grid gap-3">
          {filteredRows.length > 0 ? (
            filteredRows.map((entry) => (
              <div
                key={entry.id}
                className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 group hover:border-zinc-700 transition"
              >
                <div className="w-full md:w-auto">
                  <p className="font-bold text-sm text-white flex items-center gap-2">
                    {entry.nome || "Sem Nome"}
                    {entry.id === user?.uid && (
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-500 px-2 rounded-full border border-emerald-500/30">
                        VOCE
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500">{entry.email || "sem email"}</p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Turma: {entry.turma || "---"} - Matricula: {entry.matricula || "---"}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-1 rounded border text-[10px] uppercase font-black ${statusClass[entry.status]}`}
                  >
                    {statusLabel[entry.status]}
                  </span>

                  <select
                    value={(entry.role || "visitante").toLowerCase() === "guest" ? "visitante" : entry.role || "visitante"}
                    onChange={(event) => void handleUpdateRole(entry.id, event.target.value)}
                    className="bg-zinc-900 text-white text-xs rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer uppercase font-bold border border-zinc-700"
                    disabled={entry.id === user?.uid || !activeTenantId}
                  >
                    {ROLES.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-zinc-500 bg-zinc-900/40 border border-zinc-800 rounded-xl">
              Nenhum usuario encontrado.
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
