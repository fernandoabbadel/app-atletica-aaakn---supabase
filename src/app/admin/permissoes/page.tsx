"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  CheckSquare,
  Crown,
  DollarSign,
  Dumbbell,
  Ghost,
  LayoutList,
  Loader2,
  Lock,
  Save,
  Settings,
  Shield,
  Users,
  UserX,
  User,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { logActivity } from "@/lib/logger";
import { APP_PAGES } from "@/lib/appRoutes";
import { isPermissionError } from "@/lib/backendErrors";
import {
  fetchPermissionMatrix,
  savePermissionMatrix,
  type PermissionMatrix,
} from "@/lib/adminSecurityService";

const ROLES = [
  { id: "master", label: "Master", icon: Crown, color: "text-red-500" },
  { id: "admin_geral", label: "Admin Geral", icon: Shield, color: "text-emerald-500" },
  { id: "admin_gestor", label: "Gestor", icon: Settings, color: "text-blue-500" },
  { id: "admin_treino", label: "Adm Treino", icon: Zap, color: "text-orange-600" },
  { id: "vendas", label: "Vendas", icon: DollarSign, color: "text-yellow-400" },
  { id: "treinador", label: "Coach", icon: Dumbbell, color: "text-orange-500" },
  { id: "empresa", label: "Empresa", icon: Briefcase, color: "text-cyan-400" },
  { id: "user", label: "Membro", icon: User, color: "text-zinc-400" },
  { id: "guest", label: "Visitante", icon: Ghost, color: "text-zinc-600" },
  { id: "inactive", label: "Inativo", icon: UserX, color: "text-zinc-700" },
];

export default function AdminPermissoesPage() {
  const { user, checkPermission, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [permissionMatrix, setPermissionMatrix] = useState<PermissionMatrix>({});
  const [savingMatrix, setSavingMatrix] = useState(false);

  const isMaster = checkPermission(["master"]);

  useEffect(() => {
    if (authLoading) return;

    if (!isMaster) {
      setLoading(false);
      router.push("/dashboard");
      return;
    }

    let mounted = true;

    const fetchMatrix = async () => {
      try {
        const matrix = await fetchPermissionMatrix();
        if (!mounted) return;

        if (matrix && Object.keys(matrix).length > 0) {
          setPermissionMatrix(matrix);
        } else {
          const defaultMatrix: PermissionMatrix = {};
          APP_PAGES.forEach((page) => {
            defaultMatrix[page.path] = ["master"];
          });
          setPermissionMatrix(defaultMatrix);
        }
      } catch (error: unknown) {
        if (isPermissionError(error)) {
          addToast("Sem permissao para abrir o painel de permissoes.", "error");
          router.push("/sem-permissao");
          return;
        }
        console.error(error);
        addToast("Erro ao carregar a matriz de acessos.", "error");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void fetchMatrix();

    return () => {
      mounted = false;
    };
  }, [authLoading, isMaster, router, addToast]);

  const togglePermission = (path: string, roleId: string) => {
    setPermissionMatrix((prev) => {
      const currentRoles = prev[path] || [];
      const hasAccess = currentRoles.includes(roleId);
      const nextRoles = hasAccess
        ? currentRoles.filter((entry) => entry !== roleId)
        : [...currentRoles, roleId];

      return { ...prev, [path]: nextRoles };
    });
  };

  const saveMatrix = async () => {
    setSavingMatrix(true);
    try {
      const adminName =
        typeof user?.displayName === "string" ? user.displayName : "Admin Master";

      await savePermissionMatrix(permissionMatrix);

      await logActivity(
        user?.uid || "sistema",
        adminName,
        "UPDATE",
        "Permissoes - Matriz",
        "Atualizou a Matriz de Acesso Global"
      );

      addToast("Matriz de acessos atualizada.", "success");
    } catch (error: unknown) {
      if (isPermissionError(error)) {
        addToast("Sem permissao para salvar a matriz.", "error");
        return;
      }

      console.error(error);
      addToast("Erro ao salvar as regras.", "error");
    } finally {
      setSavingMatrix(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500 w-10 h-10" />
      </div>
    );
  }

  if (!isMaster) return null;

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-32 font-sans">
      <header className="p-6 border-b border-zinc-800 bg-[#09090b]/95 backdrop-blur sticky top-0 z-30 flex justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="bg-zinc-900 p-2 rounded-full hover:bg-zinc-800 transition">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase flex items-center gap-2">
              <Shield className="text-red-600" /> Controle de Acesso
            </h1>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
              Area Restrita do Master
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/admin/permissoes/usuarios"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-cyan-700/40 bg-zinc-900 text-cyan-300 text-[11px] font-black uppercase hover:bg-zinc-800 transition"
          >
            <Users size={14} /> Cargos
          </Link>
          <Link
            href="/admin/usuarios"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 text-[11px] font-black uppercase hover:bg-zinc-800 transition"
          >
            <Users size={14} /> Status
          </Link>
        </div>
      </header>

      <div className="p-6 max-w-[95vw] mx-auto overflow-hidden">
        <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-[11px] font-black uppercase text-zinc-400">
          <LayoutList size={14} /> Matriz de Acesso
        </div>

        <div className="space-y-6 animate-in fade-in">
          <div className="bg-yellow-900/20 border border-yellow-600/30 p-4 rounded-xl flex items-start gap-3">
            <AlertTriangle className="text-yellow-500 shrink-0" size={20} />
            <div>
              <h3 className="text-sm font-bold text-yellow-500 uppercase">Atencao, Master</h3>
              <p className="text-xs text-zinc-400 mt-1">
                Esta matriz controla o acesso por rota. Mantenha{" "}
                <b>&apos;/configuracoes&apos;</b> liberado para o cargo{" "}
                <b>&apos;Inativo&apos;</b>.
              </p>
            </div>
          </div>

          <div className="overflow-auto max-h-[70vh] rounded-xl border border-zinc-800 shadow-2xl bg-[#0a0a0a] relative">
            <table className="w-full text-left border-collapse">
              <thead className="bg-zinc-900 sticky top-0 z-40 shadow-md">
                <tr>
                  <th className="p-4 text-xs font-black text-zinc-400 uppercase tracking-wider sticky left-0 top-0 z-50 bg-zinc-900 min-w-[220px] shadow-[2px_0_5px_rgba(0,0,0,0.5)] border-b border-zinc-800">
                    Pagina / Rota
                  </th>
                  {ROLES.map((role) => (
                    <th
                      key={role.id}
                      className="p-4 min-w-[90px] text-center bg-zinc-900/95 backdrop-blur border-l border-zinc-800/50 sticky top-0 z-40 border-b border-zinc-800"
                    >
                      <div className="flex flex-col items-center gap-1.5">
                        <div className={`p-2 rounded-full bg-black/50 ${role.color}`}>
                          <role.icon size={16} />
                        </div>
                        <span className={`text-[9px] font-black uppercase ${role.color}`}>
                          {role.label}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-black">
                {APP_PAGES.map((page, idx) => {
                  const isAdmin = page.path.startsWith("/admin");
                  const prevPage = idx > 0 ? APP_PAGES[idx - 1] : null;
                  const prevIsAdmin = prevPage ? prevPage.path.startsWith("/admin") : isAdmin;
                  const showSeparator = prevPage && isAdmin !== prevIsAdmin;

                  return (
                    <React.Fragment key={page.path}>
                      {showSeparator && (
                        <tr>
                          <td colSpan={ROLES.length + 1} className="h-4 bg-zinc-900/50 border-y border-zinc-800" />
                        </tr>
                      )}

                      <tr
                        className={`group hover:bg-zinc-900/30 transition ${
                          idx !== APP_PAGES.length - 1 ? "border-b border-zinc-800/50" : ""
                        } ${isAdmin ? "bg-red-950/5 hover:bg-red-900/10" : ""}`}
                      >
                        <td
                          className={`p-4 text-xs font-bold text-white sticky left-0 z-30 group-hover:bg-zinc-900 transition border-r border-zinc-800 shadow-[2px_0_5px_rgba(0,0,0,0.5)] ${
                            isAdmin ? "bg-[#0f0505]" : "bg-black"
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className={`text-sm flex items-center gap-2 ${isAdmin ? "text-red-200" : "text-zinc-200"}`}>
                              {page.label}
                            </span>
                            <span className="text-[10px] text-zinc-600 font-mono mt-0.5">{page.path}</span>
                          </div>
                        </td>

                        {ROLES.map((role) => {
                          const isAllowed =
                            (permissionMatrix[page.path] || []).includes(role.id) || role.id === "master";

                          return (
                            <td key={`${page.path}-${role.id}`} className="p-4 text-center border-l border-zinc-800/30">
                              <button
                                onClick={() => togglePermission(page.path, role.id)}
                                disabled={role.id === "master"}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all mx-auto ${
                                  isAllowed
                                    ? "bg-emerald-500 text-black shadow-lg scale-100"
                                    : "bg-zinc-900 text-zinc-700 border border-zinc-800 scale-90 grayscale"
                                } ${role.id === "master" ? "opacity-50 cursor-not-allowed" : "hover:scale-110 active:scale-95"}`}
                              >
                                {isAllowed ? <CheckSquare size={16} strokeWidth={3} /> : <Lock size={14} />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="fixed bottom-6 right-6 z-50">
            <button
              onClick={saveMatrix}
              disabled={savingMatrix}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 px-8 rounded-full flex items-center gap-3 transition-all shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:scale-105 active:scale-95 border-4 border-[#050505]"
            >
              {savingMatrix ? <Loader2 className="animate-spin" /> : <Save size={20} />}
              SALVAR ALTERACOES
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

