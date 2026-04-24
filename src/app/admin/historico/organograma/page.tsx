"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  GripVertical,
  Loader2,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";
import {
  fetchOrganogramConfig,
  getDefaultOrganogramConfig,
  saveOrganogramConfig,
  type OrganogramConfig,
  type OrganogramMemberRecord,
} from "@/lib/organogramService";
import {
  fetchUserDirectorySegmentUsers,
  fetchUserDirectorySegments,
  searchUserDirectoryByName,
  type TreinoUserDirectoryItem,
  type TreinoUserDirectorySegment,
} from "@/lib/treinosNativeService";

type MemberFormState = {
  cargo: string;
  secao: string;
  ordem: string;
  userId: string;
  nome: string;
  foto: string;
};

const EMPTY_FORM: MemberFormState = {
  cargo: "",
  secao: "Presidência",
  ordem: "0",
  userId: "",
  nome: "",
  foto: "",
};

const createMemberId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `organograma-${Date.now()}`;

const normalizeSectionName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").slice(0, 60) || "Diretoria";

const moveListItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};

const buildSectionOrder = (
  configuredSections: string[],
  members: OrganogramMemberRecord[]
): string[] => {
  const orderedSections = Array.from(
    new Set(configuredSections.map((section) => normalizeSectionName(section)).filter(Boolean))
  );
  const missingSections = Array.from(
    new Set(members.map((member) => normalizeSectionName(member.secao)).filter(Boolean))
  ).filter((section) => !orderedSections.includes(section));
  return [...orderedSections, ...missingSections];
};

const normalizeOrganogramConfigState = (
  config: OrganogramConfig
): OrganogramConfig => {
  const normalizedMembers = config.membros.map((member) => ({
    ...member,
    secao: normalizeSectionName(member.secao),
  }));
  const ordemSecoes = buildSectionOrder(config.ordemSecoes || [], normalizedMembers);
  const normalizedMembersBySection = ordemSecoes.flatMap((section) =>
    normalizedMembers
      .filter((member) => normalizeSectionName(member.secao) === section)
      .sort(
        (left, right) =>
          left.ordem - right.ordem ||
          left.cargo.localeCompare(right.cargo, "pt-BR")
      )
      .map((member, index) => ({
        ...member,
        secao: section,
        ordem: index,
      }))
  );

  return {
    ...config,
    membros: normalizedMembersBySection,
    ordemSecoes,
  };
};

export default function AdminHistoricoOrganogramaPage() {
  const { addToast } = useToast();
  const { tenantId: activeTenantId, tenantLogoUrl, tenantSlug } = useTenantTheme();
  const backHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/historico")
    : "/admin/historico";

  const [config, setConfig] = useState<OrganogramConfig>(getDefaultOrganogramConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MemberFormState>(EMPTY_FORM);

  const [segments, setSegments] = useState<TreinoUserDirectorySegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [segmentUsers, setSegmentUsers] = useState<TreinoUserDirectoryItem[]>([]);
  const [loadingSegments, setLoadingSegments] = useState(false);
  const [loadingSegmentUsers, setLoadingSegmentUsers] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [searchResults, setSearchResults] = useState<TreinoUserDirectoryItem[]>([]);

  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [segments, selectedSegmentId]
  );

  const visibleUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (term.length >= 2) {
      return searchResults;
    }
    if (!term) return segmentUsers;
    return segmentUsers.filter((user) => user.nome.toLowerCase().includes(term));
  }, [searchResults, searchTerm, segmentUsers]);

  const orderedSections = useMemo(
    () => buildSectionOrder(config.ordemSecoes || [], config.membros),
    [config.membros, config.ordemSecoes]
  );

  const sortedMembers = useMemo(() => {
    const sectionIndex = new Map(orderedSections.map((section, index) => [section, index]));
    return [...config.membros].sort(
      (left, right) =>
        (sectionIndex.get(normalizeSectionName(left.secao)) ?? Number.MAX_SAFE_INTEGER) -
          (sectionIndex.get(normalizeSectionName(right.secao)) ?? Number.MAX_SAFE_INTEGER) ||
        left.ordem - right.ordem ||
        left.cargo.localeCompare(right.cargo, "pt-BR")
    );
  }, [config.membros, orderedSections]);

  const groupedMembers = useMemo(
    () =>
      orderedSections
        .map((section) => ({
          section,
          members: sortedMembers.filter(
            (member) => normalizeSectionName(member.secao) === section
          ),
        }))
        .filter((group) => group.members.length > 0),
    [orderedSections, sortedMembers]
  );
  const rawFormSection = form.secao.trim().replace(/\s+/g, " ").slice(0, 60);
  const normalizedFormSection = rawFormSection
    ? normalizeSectionName(rawFormSection)
    : orderedSections[0] || EMPTY_FORM.secao;
  const isCustomSection =
    rawFormSection.length === 0 || !orderedSections.includes(normalizedFormSection);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const nextConfig = await fetchOrganogramConfig({
          forceRefresh: false,
          tenantId: activeTenantId || undefined,
        });
        if (!mounted) return;
        setConfig(normalizeOrganogramConfigState(nextConfig));
      } catch (error: unknown) {
        console.error(error);
        if (!mounted) return;
        addToast("Erro ao carregar organograma.", "error");
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
  }, [activeTenantId, addToast]);

  useEffect(() => {
    let mounted = true;

    const loadSegments = async () => {
      setLoadingSegments(true);
      try {
        const nextSegments = await fetchUserDirectorySegments({
          forceRefresh: false,
          maxUsersPerSegment: 30,
          tenantId: activeTenantId || undefined,
        });
        if (!mounted) return;
        setSegments(nextSegments);
        setSelectedSegmentId((current) =>
          nextSegments.some((segment) => segment.id === current)
            ? current
            : nextSegments[0]?.id || ""
        );
      } catch (error: unknown) {
        console.error(error);
        if (!mounted) return;
        addToast("Erro ao montar grupos de usuários.", "error");
      } finally {
        if (mounted) {
          setLoadingSegments(false);
        }
      }
    };

    void loadSegments();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, addToast]);

  useEffect(() => {
    if (!selectedSegment) {
      setSegmentUsers([]);
      return;
    }

    let mounted = true;
    const loadUsers = async () => {
      setLoadingSegmentUsers(true);
      try {
        const users = await fetchUserDirectorySegmentUsers({
          segment: selectedSegment,
          tenantId: activeTenantId || undefined,
        });
        if (!mounted) return;
        setSegmentUsers(users);
      } catch (error: unknown) {
        console.error(error);
        if (!mounted) return;
        addToast("Erro ao carregar usuários do grupo.", "error");
      } finally {
        if (mounted) {
          setLoadingSegmentUsers(false);
        }
      }
    };

    void loadUsers();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, addToast, selectedSegment]);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearchingUsers(false);
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(() => {
      setSearchingUsers(true);
      void searchUserDirectoryByName({
        query: term,
        maxResults: 10,
        tenantId: activeTenantId || undefined,
      })
        .then((users) => {
          if (active) {
            setSearchResults(users);
          }
        })
        .catch((error: unknown) => {
          console.error(error);
          if (active) {
            setSearchResults([]);
          }
        })
        .finally(() => {
          if (active) {
            setSearchingUsers(false);
          }
        });
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [activeTenantId, searchTerm]);

  useEffect(() => {
    if (editingId) return;
    if (form.cargo || form.nome || form.userId) return;
    setForm((current) => {
      const nextSection =
        orderedSections[0] && orderedSections[0] !== current.secao
          ? orderedSections[0]
          : current.secao || EMPTY_FORM.secao;
      return nextSection === current.secao
        ? current
        : {
            ...current,
            secao: nextSection,
          };
    });
  }, [editingId, form.cargo, form.nome, form.userId, orderedSections]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      secao: orderedSections[0] || EMPTY_FORM.secao,
    });
  };

  const handleSelectUser = (user: TreinoUserDirectoryItem) => {
    setForm((current) => ({
      ...current,
      userId: user.uid,
      nome: user.nome,
      foto: user.foto || current.foto,
    }));
  };

  const handleClearSelectedUser = () => {
    setForm((current) => ({
      ...current,
      userId: "",
      foto: "",
    }));
  };

  const handleEditMember = (member: OrganogramMemberRecord) => {
    setEditingId(member.id);
    setForm({
      cargo: member.cargo,
      secao: member.secao,
      ordem: String(member.ordem),
      userId: member.userId || "",
      nome: member.nome || "",
      foto: member.foto || "",
    });
  };

  const handleDeleteMember = (memberId: string) => {
    setConfig((current) =>
      normalizeOrganogramConfigState({
        ...current,
        membros: current.membros.filter((member) => member.id !== memberId),
      })
    );
    if (editingId === memberId) {
      resetForm();
    }
  };

  const handleUpsertMember = () => {
    const cargo = form.cargo.trim();
    const secao = normalizeSectionName(form.secao);
    const nome = form.nome.trim();

    if (!cargo) {
      addToast("Informe o cargo do membro.", "error");
      return;
    }

    if (!form.userId.trim() && !nome) {
      addToast("Selecione um usuário ou informe o nome manual.", "error");
      return;
    }

    if (isCustomSection && !rawFormSection) {
      addToast("Informe o nome da nova seção.", "error");
      return;
    }

    const nextMember: OrganogramMemberRecord = {
      id: editingId || createMemberId(),
      cargo,
      secao,
      ordem: 0,
      ...(form.userId.trim() ? { userId: form.userId.trim() } : {}),
      ...(nome ? { nome } : {}),
      ...(form.foto.trim() && !form.userId.trim() ? { foto: form.foto.trim() } : {}),
    };

    setConfig((current) => {
      const previousMember = editingId
        ? current.membros.find((member) => member.id === editingId) ?? null
        : null;
      const remaining = current.membros.filter((member) => member.id !== nextMember.id);
      const shouldPreserveOrder =
        previousMember && normalizeSectionName(previousMember.secao) === secao;
      const nextOrder = shouldPreserveOrder
        ? previousMember.ordem
        : remaining.filter((member) => normalizeSectionName(member.secao) === secao).length;
      return normalizeOrganogramConfigState({
        ...current,
        membros: [...remaining, { ...nextMember, ordem: nextOrder }],
        ordemSecoes: current.ordemSecoes.includes(secao)
          ? current.ordemSecoes
          : [...current.ordemSecoes, secao],
      });
    });
    resetForm();
  };

  const handleMoveSection = (section: string, direction: "up" | "down") => {
    setConfig((current) => {
      const nextSections = buildSectionOrder(current.ordemSecoes || [], current.membros);
      const currentIndex = nextSections.indexOf(section);
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      return normalizeOrganogramConfigState({
        ...current,
        ordemSecoes: moveListItem(nextSections, currentIndex, targetIndex),
      });
    });
  };

  const handleMoveMember = (memberId: string, direction: "up" | "down") => {
    setConfig((current) => {
      const targetMember = current.membros.find((member) => member.id === memberId);
      if (!targetMember) return current;

      const targetSection = normalizeSectionName(targetMember.secao);
      const sectionMembers = current.membros
        .filter((member) => normalizeSectionName(member.secao) === targetSection)
        .sort(
          (left, right) =>
            left.ordem - right.ordem ||
            left.cargo.localeCompare(right.cargo, "pt-BR")
        );
      const currentIndex = sectionMembers.findIndex((member) => member.id === memberId);
      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sectionMembers.length) {
        return current;
      }

      const reorderedSectionMembers = moveListItem(sectionMembers, currentIndex, nextIndex).map(
        (member, index) => ({
          ...member,
          ordem: index,
        })
      );
      const reorderedMap = new Map(
        reorderedSectionMembers.map((member) => [member.id, member])
      );

      return normalizeOrganogramConfigState({
        ...current,
        membros: current.membros.map((member) =>
          reorderedMap.get(member.id) ?? member
        ),
      });
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const normalizedConfig = normalizeOrganogramConfigState(config);
      setConfig(normalizedConfig);
      await saveOrganogramConfig(normalizedConfig, {
        tenantId: activeTenantId || undefined,
      });
      addToast("Organograma salvo com sucesso.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar organograma.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505]">
        <Loader2 className="animate-spin text-emerald-500" size={42} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] pb-20 text-white">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-[#050505]/92 px-6 py-5 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 transition hover:border-zinc-600"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                Memoria institucional
              </p>
              <h1 className="text-2xl font-black uppercase tracking-tight">
                Organograma
              </h1>
            </div>
          </div>

          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500 bg-emerald-500 px-4 py-3 text-xs font-black uppercase text-black transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="space-y-6">
          <article className="rounded-[28px] border border-zinc-800 bg-zinc-950/90 p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                  Página pública
                </p>
                <h2 className="text-lg font-black uppercase">Cabeçalho</h2>
              </div>
            </div>

            <div className="grid gap-4">
              <label className="text-xs font-black uppercase text-zinc-500">
                Título
                <input
                  value={config.tituloPagina}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      tituloPagina: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
                />
              </label>

              <label className="text-xs font-black uppercase text-zinc-500">
                Subtítulo
                <textarea
                  value={config.subtituloPagina}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      subtituloPagina: event.target.value,
                    }))
                  }
                  rows={3}
                  className="mt-2 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
                />
              </label>
            </div>
          </article>

          <article className="rounded-[28px] border border-zinc-800 bg-zinc-950/90 p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                  Buscar usuário
                </p>
                <h2 className="text-lg font-black uppercase">
                  Base segmentada
                </h2>
              </div>

              <button
                onClick={() =>
                  void fetchUserDirectorySegments({
                    forceRefresh: true,
                    maxUsersPerSegment: 30,
                    tenantId: activeTenantId || undefined,
                  }).then((nextSegments) => {
                    setSegments(nextSegments);
                    setSelectedSegmentId(nextSegments[0]?.id || "");
                  })
                }
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black px-3 py-2 text-[11px] font-black uppercase text-zinc-300"
              >
                <RefreshCw size={13} />
                Atualizar
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {segments.map((segment) => (
                <button
                  key={segment.id}
                  onClick={() => setSelectedSegmentId(segment.id)}
                  className={`rounded-full border px-3 py-2 text-[11px] font-black uppercase transition ${
                    selectedSegmentId === segment.id
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                      : "border-zinc-700 bg-black text-zinc-300"
                  }`}
                >
                  {segment.label} ({segment.count})
                </button>
              ))}
            </div>

            <div className="relative mt-4">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Buscar usuário por nome"
                className="w-full rounded-2xl border border-zinc-700 bg-black py-3 pl-11 pr-4 text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div className="mt-4 rounded-[24px] border border-zinc-800 bg-black/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                  {searchTerm.trim().length >= 2
                    ? "Resultados da busca"
                    : selectedSegment
                      ? `Grupo ${selectedSegment.label}`
                    : "Usuários"}
                </p>
                {(loadingSegments || loadingSegmentUsers || searchingUsers) && (
                  <Loader2 size={14} className="animate-spin text-emerald-500" />
                )}
              </div>

              {visibleUsers.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Nenhum usuário encontrado nesse recorte.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {visibleUsers.map((user) => (
                    <button
                      key={user.uid}
                      onClick={() => handleSelectUser(user)}
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        form.userId === user.uid
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                      }`}
                    >
                      <div className="relative h-11 w-11 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900">
                        <Image
                          src={user.foto || tenantLogoUrl || "/logo.png"}
                          alt={user.nome}
                          fill
                          sizes="44px"
                          className={`object-cover ${
                            user.foto ? "" : "opacity-70 grayscale"
                          }`}
                          unoptimized={Boolean(user.foto && user.foto.startsWith("http"))}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-white">
                          {user.nome}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                          {user.turma || "Sem turma"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </article>

          <article className="rounded-[28px] border border-zinc-800 bg-zinc-950/90 p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                  Cadastro
                </p>
                <h2 className="text-lg font-black uppercase">
                  {editingId ? "Editar membro" : "Adicionar membro"}
                </h2>
              </div>

              {editingId ? (
                <button
                  onClick={resetForm}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black px-3 py-2 text-[11px] font-black uppercase text-zinc-300"
                >
                  <XCircle size={13} />
                  Cancelar
                </button>
              ) : null}
            </div>

            {form.userId ? (
              <div className="mb-4 flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">
                    Usuário vinculado
                  </p>
                  <p className="text-sm font-black text-white">{form.nome || form.userId}</p>
                </div>
                <button
                  onClick={handleClearSelectedUser}
                  className="text-xs font-black uppercase text-zinc-200"
                >
                  Limpar
                </button>
              </div>
            ) : (
              <div className="mb-4 rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 text-xs text-zinc-400">
                Se o membro ainda não estiver cadastrado, preencha o nome manualmente.
                A página pública usará o logo da atlética com visual opaco até a vinculação.
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs font-black uppercase text-zinc-500">
                Cargo
                <input
                  value={form.cargo}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, cargo: event.target.value }))
                  }
                  className="mt-2 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
                  placeholder="Presidente, Vice, Diretora de Eventos..."
                />
              </label>

              <label className="text-xs font-black uppercase text-zinc-500">
                Seção
                <select
                  value={isCustomSection ? "__custom__" : normalizedFormSection}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm((current) => ({
                      ...current,
                      secao: value === "__custom__" ? "" : value,
                    }));
                  }}
                  className="mt-2 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
                >
                  {orderedSections.map((section) => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                  <option value="__custom__">Criar nova seção</option>
                </select>
              </label>

              <label className="text-xs font-black uppercase text-zinc-500">
                Nome manual
                <input
                  value={form.nome}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, nome: event.target.value }))
                  }
                  className="mt-2 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
                    placeholder="Use quando o usuário ainda não existir"
                />
              </label>

              <label className="text-xs font-black uppercase text-zinc-500">
                {isCustomSection ? "Nova seção" : "Posição"}
                <input
                  value={isCustomSection ? form.secao : "Organizada automaticamente dentro da seção"}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, secao: event.target.value }))
                  }
                  className="mt-2 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
                  placeholder="Ex.: Presidência, Administrativo, Eventos..."
                  disabled={!isCustomSection}
                />
              </label>
            </div>

            <button
              onClick={handleUpsertMember}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-emerald-500 bg-emerald-500 px-4 py-3 text-xs font-black uppercase text-black transition hover:bg-emerald-400"
            >
              {editingId ? <PencilLine size={14} /> : <UserPlus size={14} />}
              {editingId ? "Atualizar membro" : "Adicionar membro"}
            </button>
          </article>
        </section>

        <section>
          <article className="rounded-[28px] border border-zinc-800 bg-zinc-950/90 p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                  Quadro atual
                </p>
                <h2 className="text-lg font-black uppercase">Membros</h2>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                  Total
                </p>
                <p className="text-2xl font-black text-emerald-400">
                  {sortedMembers.length}
                </p>
              </div>
            </div>

            <div className="mb-5 rounded-[24px] border border-zinc-800 bg-black/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                    Organizar seções
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    Ajuste a ordem das seções por aqui. A posição dos membros dentro de cada seção é independente.
                  </p>
                </div>
              </div>

              {orderedSections.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/80 px-4 py-6 text-center text-sm text-zinc-500">
                  As seções aparecem aqui depois que você cadastrar o primeiro membro.
                </div>
              ) : (
                <div className="space-y-2">
                  {orderedSections.map((section, index) => {
                    const membersCount = groupedMembers.find((group) => group.section === section)?.members.length || 0;
                    return (
                      <div
                        key={section}
                        className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-3"
                      >
                        <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-700 bg-black/40 text-zinc-400">
                          <GripVertical size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black uppercase text-white">{section}</p>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                            {membersCount} membro{membersCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleMoveSection(section, "up")}
                            disabled={index === 0}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-700 bg-black/40 text-zinc-200 disabled:opacity-30"
                            title="Subir seção"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            onClick={() => handleMoveSection(section, "down")}
                            disabled={index === orderedSections.length - 1}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-700 bg-black/40 text-zinc-200 disabled:opacity-30"
                            title="Descer seção"
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {groupedMembers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-black/40 px-4 py-10 text-center text-zinc-500">
                Nenhum membro adicionado ainda.
              </div>
            ) : (
              <div className="space-y-4">
                {groupedMembers.map((group) => (
                  <div key={group.section} className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                          Seção
                        </p>
                        <h3 className="text-base font-black uppercase text-white">{group.section}</h3>
                      </div>
                      <span className="rounded-full border border-zinc-700 bg-black/40 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-zinc-300">
                        {group.members.length} membro{group.members.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    {group.members.map((member, index) => {
                      const profileHref = member.userId
                        ? tenantSlug
                          ? withTenantSlug(tenantSlug, `/perfil/${member.userId}`)
                          : `/perfil/${member.userId}`
                        : "";

                      return (
                        <article
                          key={member.id}
                          className="flex items-center gap-4 rounded-[24px] border border-zinc-800 bg-black/40 px-4 py-4"
                        >
                          <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900">
                            <Image
                              src={member.foto || tenantLogoUrl || "/logo.png"}
                              alt={member.nome || member.cargo}
                              fill
                              sizes="56px"
                              className={`object-cover ${member.userId ? "" : "opacity-70 grayscale"}`}
                              unoptimized={Boolean(member.foto && member.foto.startsWith("http"))}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-brand">
                              {member.cargo}
                            </p>
                            <h4 className="truncate text-base font-black uppercase text-white">
                              {member.nome || member.userId || "Vinculação pendente"}
                            </h4>
                            <p className="truncate text-xs font-bold uppercase tracking-wide text-zinc-500">
                              Posição {index + 1} na seção
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleMoveMember(member.id, "up")}
                              disabled={index === 0}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 disabled:opacity-30"
                              title="Subir membro"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              onClick={() => handleMoveMember(member.id, "down")}
                              disabled={index === group.members.length - 1}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 disabled:opacity-30"
                              title="Descer membro"
                            >
                              <ArrowDown size={14} />
                            </button>
                            {profileHref ? (
                              <Link
                                href={profileHref}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                                title="Abrir perfil"
                              >
                                <ExternalLink size={14} />
                              </Link>
                            ) : null}
                            <button
                              onClick={() => handleEditMember(member)}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200"
                              title="Editar membro"
                            >
                              <PencilLine size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteMember(member.id)}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-red-900/40 bg-red-900/20 text-red-300"
                              title="Remover membro"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>
      </main>
    </div>
  );
}
