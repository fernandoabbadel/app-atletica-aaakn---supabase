"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Check, Clock3, HeartHandshake, Loader2, Users, X } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchMentorshipHubBundle,
  respondToMentorshipInvite,
  type MentorshipHubBundle,
  type MentorshipLabelsConfig,
  type MentorshipRoleSide,
  type MentorshipRequestRecord,
  resolveMentorshipRoleOptions,
  updateMentorshipRoleLabel,
} from "@/lib/mentorshipService";
import { withTenantSlug } from "@/lib/tenantRouting";

const EMPTY_BUNDLE: MentorshipHubBundle = {
  labels: {
    hubTitle: "Apadrinhamento",
    mentorLabel: "Padrinho/Madrinha",
    menteeLabel: "Afilhado/Afilhada",
    inviteMentorLabel: "Adicionar como meu padrinho/madrinha",
    inviteMenteeLabel: "Adicionar como meu afilhado/afilhada",
    requestHelpText: "Cada perfil pode ter 1 padrinho/madrinha e 1 afilhado/afilhada por atletica.",
  },
  mentor: null,
  mentee: null,
  incoming: [],
  outgoing: [],
};

const resolveOtherSide = (row: MentorshipRequestRecord, currentUserId: string) =>
  row.mentorUserId === currentUserId ? row.mentee : row.mentor;

const resolveCurrentUserSide = (
  row: MentorshipRequestRecord,
  currentUserId: string
): MentorshipRoleSide => (row.mentorUserId === currentUserId ? "mentor" : "mentee");

const buildAcceptanceRoleLabels = (
  labels: MentorshipLabelsConfig,
  currentUserSide: MentorshipRoleSide,
  selectedRoleLabel: string
): { mentorRoleLabel: string; menteeRoleLabel: string } => {
  const mentorOptions = resolveMentorshipRoleOptions(labels, "mentor");
  const menteeOptions = resolveMentorshipRoleOptions(labels, "mentee");

  return {
    mentorRoleLabel:
      currentUserSide === "mentor" ? selectedRoleLabel : mentorOptions[0] || labels.mentorLabel,
    menteeRoleLabel:
      currentUserSide === "mentee" ? selectedRoleLabel : menteeOptions[0] || labels.menteeLabel,
  };
};

export default function ConfiguracoesApadrinhamentoPage() {
  const { user } = useAuth();
  const { tenantId, tenantName, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [bundle, setBundle] = useState<MentorshipHubBundle>(EMPTY_BUNDLE);
  const [actionId, setActionId] = useState("");
  const [editingRoleId, setEditingRoleId] = useState("");

  const effectiveTenantId =
    tenantId.trim() || (typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "");
  const settingsHref = tenantSlug ? withTenantSlug(tenantSlug, "/configuracoes") : "/configuracoes";

  const loadBundle = useCallback(
    async (forceRefresh = false) => {
      if (!effectiveTenantId || !user?.uid) {
        setBundle(EMPTY_BUNDLE);
        setLoading(false);
        return;
      }

      try {
        const nextBundle = await fetchMentorshipHubBundle({
          tenantId: effectiveTenantId,
          userId: user.uid,
          forceRefresh,
        });
        setBundle(nextBundle);
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar o apadrinhamento.", "error");
      } finally {
        setLoading(false);
      }
    },
    [addToast, effectiveTenantId, user?.uid]
  );

  useEffect(() => {
    void loadBundle(true);
  }, [loadBundle]);

  const handleAction = async (
    relationshipId: string,
    action: "accept" | "reject" | "cancel" | "remove",
    options?: {
      row?: MentorshipRequestRecord;
      selectedRoleLabel?: string;
    }
  ) => {
    if (!effectiveTenantId || !user?.uid || !relationshipId || actionId || editingRoleId) return;
    try {
      setActionId(relationshipId);
      const acceptanceLabels =
        action === "accept" && options?.row && options?.selectedRoleLabel
          ? buildAcceptanceRoleLabels(
              bundle.labels,
              resolveCurrentUserSide(options.row, user.uid),
              options.selectedRoleLabel
            )
          : null;
      await respondToMentorshipInvite({
        tenantId: effectiveTenantId,
        relationshipId,
        currentUserId: user.uid,
        action,
        mentorRoleLabel: acceptanceLabels?.mentorRoleLabel,
        menteeRoleLabel: acceptanceLabels?.menteeRoleLabel,
      });
      addToast(
        action === "accept"
          ? "Convite aceito."
          : action === "reject"
            ? "Convite recusado."
            : action === "remove"
              ? "Vinculo removido."
              : "Convite cancelado.",
        "success"
      );
      await loadBundle(true);
    } catch (error: unknown) {
      console.error(error);
      addToast(error instanceof Error ? error.message : "Erro ao responder convite.", "error");
    } finally {
      setActionId("");
    }
  };

  const handleEditRoleLabel = async (
    relationshipId: string,
    roleSide: MentorshipRoleSide,
    selectedRoleLabel: string
  ) => {
    if (!effectiveTenantId || !user?.uid || !relationshipId || actionId || editingRoleId) return;
    try {
      setEditingRoleId(relationshipId);
      await updateMentorshipRoleLabel({
        tenantId: effectiveTenantId,
        relationshipId,
        currentUserId: user.uid,
        roleSide,
        roleLabel: selectedRoleLabel,
      });
      addToast("Rotulo atualizado.", "success");
      await loadBundle(true);
    } catch (error: unknown) {
      console.error(error);
      addToast(error instanceof Error ? error.message : "Erro ao editar rotulo.", "error");
    } finally {
      setEditingRoleId("");
    }
  };

  const labels = bundle.labels;

  return (
    <div className="min-h-screen bg-[#050505] pb-24 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-4 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link href={settingsHref} className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800">
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-lg font-black uppercase tracking-tight">{labels.hubTitle}</h1>
            <p className="text-[11px] font-bold text-zinc-500">
              Convites, aceite e visibilidade em {tenantName || "sua atletica"}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <section className="overflow-hidden rounded-[2rem] border border-emerald-500/20 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_35%),linear-gradient(135deg,rgba(6,78,59,0.35),rgba(10,10,10,0.95)_45%,rgba(6,78,59,0.18))] p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              <HeartHandshake size={22} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">
                Relacoes da Atletica
              </p>
              <h2 className="mt-1 text-xl font-black uppercase tracking-tight text-white">
                {labels.mentorLabel} e {labels.menteeLabel}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-emerald-50/75">{labels.requestHelpText}</p>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="flex items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-900/60 p-10">
            <Loader2 className="animate-spin text-emerald-400" />
          </div>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2">
              <RoleCard
                title={labels.mentorLabel}
                emptyText={`Voce ainda nao tem ${labels.mentorLabel.toLowerCase()}.`}
                item={bundle.mentor}
                tenantSlug={tenantSlug}
                editOptions={resolveMentorshipRoleOptions(
                  labels,
                  bundle.mentor?.ownerRoleSide || "mentee"
                )}
                onEditOption={
                  bundle.mentor
                    ? (selectedRoleLabel) =>
                        void handleEditRoleLabel(
                          bundle.mentor!.relationshipId,
                          bundle.mentor!.ownerRoleSide,
                          selectedRoleLabel
                        )
                    : undefined
                }
                editingLabel={editingRoleId === bundle.mentor?.relationshipId}
                removing={actionId === bundle.mentor?.relationshipId}
                onRemove={
                  bundle.mentor
                    ? () => void handleAction(bundle.mentor!.relationshipId, "remove")
                    : undefined
                }
              />
              <RoleCard
                title={labels.menteeLabel}
                emptyText={`Voce ainda nao tem ${labels.menteeLabel.toLowerCase()}.`}
                item={bundle.mentee}
                tenantSlug={tenantSlug}
                editOptions={resolveMentorshipRoleOptions(
                  labels,
                  bundle.mentee?.ownerRoleSide || "mentor"
                )}
                onEditOption={
                  bundle.mentee
                    ? (selectedRoleLabel) =>
                        void handleEditRoleLabel(
                          bundle.mentee!.relationshipId,
                          bundle.mentee!.ownerRoleSide,
                          selectedRoleLabel
                        )
                    : undefined
                }
                editingLabel={editingRoleId === bundle.mentee?.relationshipId}
                removing={actionId === bundle.mentee?.relationshipId}
                onRemove={
                  bundle.mentee
                    ? () => void handleAction(bundle.mentee!.relationshipId, "remove")
                    : undefined
                }
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Clock3 size={16} className="text-amber-300" />
                  <h3 className="text-sm font-black uppercase text-white">Convites Recebidos</h3>
                </div>
                <div className="space-y-3">
                  {bundle.incoming.length === 0 ? (
                    <EmptyList text="Nenhum convite pendente para voce agora." />
                  ) : (
                    bundle.incoming.map((row) => {
                      const other = resolveOtherSide(row, user?.uid || "");
                      return (
                        <RequestCard
                          key={row.id}
                          name={other?.nome || "Atleta"}
                          photo={other?.foto || ""}
                          turma={other?.turma || "Sem turma"}
                          helper={row.mentorUserId === user?.uid ? `Quer te ter como ${labels.mentorLabel}.` : `Quer te ter como ${labels.menteeLabel}.`}
                          loading={actionId === row.id}
                          acceptOptions={resolveMentorshipRoleOptions(
                            labels,
                            resolveCurrentUserSide(row, user?.uid || "")
                          )}
                          onAcceptOption={(selectedRoleLabel) =>
                            void handleAction(row.id, "accept", {
                              row,
                              selectedRoleLabel,
                            })
                          }
                          onReject={() => void handleAction(row.id, "reject")}
                          tenantSlug={tenantSlug}
                          profileId={other?.uid || ""}
                        />
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Users size={16} className="text-cyan-300" />
                  <h3 className="text-sm font-black uppercase text-white">Convites Enviados</h3>
                </div>
                <div className="space-y-3">
                  {bundle.outgoing.length === 0 ? (
                    <EmptyList text="Voce ainda nao enviou convite de apadrinhamento." />
                  ) : (
                    bundle.outgoing.map((row) => {
                      const other = resolveOtherSide(row, user?.uid || "");
                      return (
                        <RequestCard
                          key={row.id}
                          name={other?.nome || "Atleta"}
                          photo={other?.foto || ""}
                          turma={other?.turma || "Sem turma"}
                          helper={row.mentorUserId === user?.uid ? `Convite para ${labels.menteeLabel.toLowerCase()}.` : `Convite para ${labels.mentorLabel.toLowerCase()}.`}
                          loading={actionId === row.id}
                          onCancel={() => void handleAction(row.id, "cancel")}
                          tenantSlug={tenantSlug}
                          profileId={other?.uid || ""}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function RoleCard({
  title,
  emptyText,
  item,
  tenantSlug,
  editOptions,
  onEditOption,
  editingLabel,
  removing,
  onRemove,
}: {
  title: string;
  emptyText: string;
  item: MentorshipHubBundle["mentor"];
  tenantSlug: string;
  editOptions?: string[];
  onEditOption?: (selectedRoleLabel: string) => void;
  editingLabel?: boolean;
  removing?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
        {item?.roleLabel || title}
      </p>
      {item ? (
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-black/30 p-4">
          <Link
            href={tenantSlug ? withTenantSlug(tenantSlug, `/perfil/${item.user.uid}`) : `/perfil/${item.user.uid}`}
            className="flex items-center gap-4 transition hover:opacity-90"
          >
            <div className="relative h-20 w-20 overflow-hidden rounded-full border border-zinc-700 bg-zinc-950">
              <Image
                src={item.user.foto || "https://github.com/shadcn.png"}
                alt={item.user.nome}
                fill
                sizes="80px"
                className="object-cover"
              />
            </div>
            <div>
              <p className="text-base font-black uppercase text-white">{item.user.nome}</p>
              <p className="text-[11px] font-bold uppercase text-zinc-500">
                {item.user.turma || "Sem turma"}
              </p>
              <p className="mt-2 text-[11px] font-bold text-emerald-300">Abrir perfil</p>
            </div>
          </Link>

          {onRemove ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {onEditOption && editOptions && editOptions.length > 1 ? (
                <>
                  <div className="w-full text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                    Meu rotulo
                  </div>
                  {editOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => onEditOption(option)}
                      disabled={editingLabel || option === item.ownerRoleLabel}
                      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-black uppercase disabled:opacity-60 ${
                        option === item.ownerRoleLabel
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-white"
                      }`}
                    >
                      {editingLabel && option !== item.ownerRoleLabel ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Check size={14} />
                      )}
                      {option}
                    </button>
                  ))}
                </>
              ) : null}

              <button
                type="button"
                onClick={onRemove}
                disabled={removing}
                className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase text-red-300 hover:bg-red-500/20 disabled:opacity-60"
              >
                {removing ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                Remover vinculo
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-black/20 p-5 text-sm text-zinc-500">
          {emptyText}
        </div>
      )}
    </div>
  );
}

function RequestCard({
  name,
  photo,
  turma,
  helper,
  loading,
  acceptOptions,
  onAcceptOption,
  onReject,
  onCancel,
  tenantSlug,
  profileId,
}: {
  name: string;
  photo: string;
  turma: string;
  helper: string;
  loading: boolean;
  acceptOptions?: string[];
  onAcceptOption?: (selectedRoleLabel: string) => void;
  onReject?: () => void;
  onCancel?: () => void;
  tenantSlug: string;
  profileId: string;
}) {
  const profileHref = tenantSlug ? withTenantSlug(tenantSlug, `/perfil/${profileId}`) : `/perfil/${profileId}`;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-black/30 p-4">
      <div className="flex items-center gap-3">
        <div className="relative h-14 w-14 overflow-hidden rounded-full border border-zinc-700 bg-zinc-950">
          <Image
            src={photo || "https://github.com/shadcn.png"}
            alt={name}
            fill
            sizes="56px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <Link href={profileHref} className="text-sm font-black uppercase text-white hover:text-emerald-300">
            {name}
          </Link>
          <p className="text-[11px] font-bold uppercase text-zinc-500">{turma}</p>
          <p className="mt-1 text-xs text-zinc-400">{helper}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {onAcceptOption
          ? (acceptOptions && acceptOptions.length > 0 ? acceptOptions : ["Aceitar"]).map(
              (option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onAcceptOption(option)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {acceptOptions && acceptOptions.length > 1 ? `Aceitar como ${option}` : "Aceitar"}
                </button>
              )
            )
          : null}
        {onReject ? (
          <button
            type="button"
            onClick={onReject}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase text-red-300 hover:bg-red-500/20 disabled:opacity-60"
          >
            <X size={14} />
            Recusar
          </button>
        ) : null}
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
            Cancelar
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyList({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-zinc-800 bg-black/20 p-5 text-sm text-zinc-500">{text}</div>;
}
