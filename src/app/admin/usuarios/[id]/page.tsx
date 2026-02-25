"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  Loader2,
  Save,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { isFirebasePermissionError } from "@/lib/firebaseErrors";
import {
  deleteAdminUser,
  fetchAdminUserProfile,
  setAdminUserStatus,
  updateAdminUser,
  type AdminUserProfileRecord,
} from "@/lib/adminUsersService";

type AdminStatus = "ativo" | "inadimplente" | "pendente" | "bloqueado";
type AdminPlan = "lenda" | "atleta" | "cardume" | "bicho";

interface UserForm {
  nome: string;
  telefone: string;
  matricula: string;
  turma: string;
  status: AdminStatus;
  plano: AdminPlan;
}

const normalizeStatus = (value: unknown): AdminStatus => {
  if (
    value === "ativo" ||
    value === "inadimplente" ||
    value === "pendente" ||
    value === "bloqueado"
  ) {
    return value;
  }
  return "pendente";
};

const normalizePlan = (value: unknown): AdminPlan => {
  if (value === "lenda" || value === "atleta" || value === "cardume") {
    return value;
  }
  return "bicho";
};

const toInitialForm = (profile: AdminUserProfileRecord): UserForm => ({
  nome: typeof profile.nome === "string" ? profile.nome : "",
  telefone: typeof profile.telefone === "string" ? profile.telefone : "",
  matricula: typeof profile.matricula === "string" ? profile.matricula : "",
  turma: typeof profile.turma === "string" ? profile.turma : "",
  status: normalizeStatus(profile.status),
  plano: normalizePlan(profile.tier),
});

export default function AdminUsuarioDetalhePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { addToast } = useToast();

  const userId = useMemo(() => params?.id?.trim() || "", [params]);

  const [profile, setProfile] = useState<AdminUserProfileRecord | null>(null);
  const [form, setForm] = useState<UserForm | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await fetchAdminUserProfile(userId, { forceRefresh: false });
      if (!result) {
        addToast("Usuario nao encontrado.", "error");
        router.replace("/admin/usuarios");
        return;
      }

      setProfile(result);
      setForm(toInitialForm(result));
    } catch (error: unknown) {
      if (!isFirebasePermissionError(error)) { console.error(error); }
      addToast("Erro ao carregar usuario.", "error");
    } finally {
      setLoading(false);
    }
  }, [userId, addToast, router]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleSave = async () => {
    if (!userId || !form) return;

    setSaving(true);
    try {
      await updateAdminUser({
        userId,
        nome: form.nome,
        telefone: form.telefone,
        matricula: form.matricula,
        turma: form.turma,
        status: form.status,
        plano: form.plano,
      });

      setProfile((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          nome: form.nome,
          telefone: form.telefone,
          matricula: form.matricula,
          turma: form.turma,
          status: form.status,
          tier: form.plano,
        };
      });

      addToast("Usuario atualizado.", "success");
    } catch (error: unknown) {
      if (!isFirebasePermissionError(error)) { console.error(error); }
      addToast("Erro ao salvar.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!userId || !form) return;

    const nextStatus: AdminStatus =
      form.status === "bloqueado" ? "ativo" : "bloqueado";

    setChangingStatus(true);
    try {
      await setAdminUserStatus({ userId, status: nextStatus });
      setForm((prev) => (prev ? { ...prev, status: nextStatus } : prev));
      setProfile((prev) => (prev ? { ...prev, status: nextStatus } : prev));
      addToast(
        nextStatus === "bloqueado"
          ? "Usuario bloqueado."
          : "Usuario desbloqueado.",
        "success"
      );
    } catch (error: unknown) {
      if (!isFirebasePermissionError(error)) { console.error(error); }
      addToast("Erro ao alterar status.", "error");
    } finally {
      setChangingStatus(false);
    }
  };

  const handleDelete = async () => {
    if (!userId) return;

    const confirmed = window.confirm(
      "Confirmar exclusao permanente deste usuario?"
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteAdminUser(userId);
      addToast("Usuario excluido.", "success");
      router.replace("/admin/usuarios");
    } catch (error: unknown) {
      if (!isFirebasePermissionError(error)) { console.error(error); }
      addToast("Erro ao excluir usuario.", "error");
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" size={28} />
      </div>
    );
  }

  if (!profile || !form) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/usuarios"
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                <User size={18} className="text-emerald-400" /> Perfil do Usuario
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold">UID: {userId}</p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-xs text-zinc-400">{profile.email || "sem email"}</p>
            <p className="text-[11px] uppercase font-black text-zinc-500">
              role: {profile.role || "user"}
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-3xl mx-auto space-y-4">
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-black uppercase text-zinc-500 block mb-1">
                Nome
              </label>
              <input
                value={form.nome}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, nome: event.target.value } : prev
                  )
                }
                className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-black uppercase text-zinc-500 block mb-1">
                Telefone
              </label>
              <input
                value={form.telefone}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, telefone: event.target.value } : prev
                  )
                }
                className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-black uppercase text-zinc-500 block mb-1">
                Matricula
              </label>
              <input
                value={form.matricula}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, matricula: event.target.value } : prev
                  )
                }
                className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-black uppercase text-zinc-500 block mb-1">
                Turma
              </label>
              <input
                value={form.turma}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, turma: event.target.value } : prev
                  )
                }
                className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-black uppercase text-zinc-500 block mb-1">
                Plano
              </label>
              <select
                value={form.plano}
                onChange={(event) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, plano: normalizePlan(event.target.value) }
                      : prev
                  )
                }
                className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              >
                <option value="bicho">Bicho</option>
                <option value="cardume">Cardume</option>
                <option value="atleta">Atleta</option>
                <option value="lenda">Lenda</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-black uppercase text-zinc-500 block mb-1">
                Status
              </label>
              <select
                value={form.status}
                onChange={(event) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          status: normalizeStatus(event.target.value),
                        }
                      : prev
                  )
                }
                className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              >
                <option value="ativo">Ativo</option>
                <option value="pendente">Pendente</option>
                <option value="inadimplente">Inadimplente</option>
                <option value="bloqueado">Bloqueado</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase flex items-center gap-2 disabled:opacity-60"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Salvar
            </button>

            <button
              onClick={() => void handleToggleStatus()}
              disabled={changingStatus}
              className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase flex items-center gap-2 disabled:opacity-60"
            >
              {changingStatus ? (
                <Loader2 size={15} className="animate-spin" />
              ) : form.status === "bloqueado" ? (
                <ShieldCheck size={15} />
              ) : (
                <Ban size={15} />
              )}
              {form.status === "bloqueado" ? "Desbloquear" : "Bloquear"}
            </button>

            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="px-4 py-2 rounded-xl border border-red-700/40 bg-red-900/20 text-red-300 text-xs font-black uppercase flex items-center gap-2 disabled:opacity-60"
            >
              {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              Excluir
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

