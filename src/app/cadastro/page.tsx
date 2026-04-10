// src/app/cadastro/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { 
  User, Hash, Instagram, FileText, Phone, Save, Loader2, ShieldAlert, 
  Eye, EyeOff, CheckCircle2, MapPin, Heart, Trophy, PawPrint, 
  ArrowLeft, BadgeCheck, Lock, Camera, UploadCloud, Building2 
} from "lucide-react";
import { useAuth } from "../../context/AuthContext"; 
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { markProfileComplete, uploadProfileImage } from "../../lib/profileService";
import { validateImageFile } from "../../lib/upload";
import { isPermissionError } from "../../lib/backendErrors";
import { useToast } from "../../context/ToastContext"; 
import { getTurmaImage } from "../../constants/turmaImages";
import { buildLoginPath } from "@/lib/authRedirect";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";
import {
  fetchInviteResolvedContext,
  fetchPendingMembershipStatusForCurrentUser,
  requestJoinManual,
  requestJoinWithInvite,
} from "../../lib/tenantService";
import {
  clearStoredInviteToken,
  readStoredInviteToken,
  sanitizeInviteToken,
  storeInviteToken,
} from "@/lib/inviteTokenStorage";
import {
  fetchTurmasConfig,
  getDefaultTurmas,
  readActiveTurmasSnapshot,
  type TurmaConfig,
} from "@/lib/turmasService";
import BirthDateField from "@/components/forms/BirthDateField";
import {
  fetchCadastroConfig,
  getDefaultCadastroConfig,
  type CadastroConfig,
} from "@/lib/cadastroConfigService";
import {
  DEFAULT_PET_OPTIONS,
  DEFAULT_STATUS_RELACIONAMENTO_OPTIONS,
  normalizeSelectedSportIds,
} from "@/lib/cadastroOptions";

// ðŸ¦ˆ ID 3: Interfaces para remover 'any'
interface IBGEUF {
  id: number;
  sigla: string;
  nome: string;
}

interface IBGECity {
  id: number;
  nome: string;
}

// ðŸ¦ˆ INTERFACE ESTRITA
interface UserFormData {
    nome: string;
    apelido: string;
    matricula: string;
    turma: string;
    instagram: string;
    telefone: string;
    whatsappPublico: boolean;
    bio: string;
    dataNascimento: string;
    idadePublica: boolean;
    cidadeOrigem: string;
    estadoOrigem: string;
    statusRelacionamento: string;
    relacionamentoPublico: boolean;
    esportes: string[];
    pets: string;
    foto: string;
}

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
    const message = [raw.message, raw.details, raw.hint]
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .filter((entry) => entry.length > 0)
      .join(" | ");
    if (message) return message;
  }
  return "Erro inesperado.";
};

const normalizeInviteJoinFailureMessage = (message: string): string => {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("token esgotado")) {
    return "Deu ruim no plantao! O limite desse convite ja era.";
  }
  if (normalized.includes("token expirado")) {
    return "Esse convite expirou. Peca um link novo para entrar.";
  }
  if (
    normalized.includes("token invalido") ||
    normalized.includes("inativo") ||
    normalized.includes("revogado")
  ) {
    return "Esse convite nao esta mais disponivel. Peca um link novo.";
  }
  return message.trim();
};

const GUEST_PLACEHOLDER_NAME = "visitante usc";

export default function CadastroPage() {
  const { user, updateUser, logout, loading: authLoading } = useAuth();
  const { tenantId, tenantName, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const pathname = usePathname() || "/cadastro";
  const router = useRouter();
  const searchParams = useSearchParams();
  const routePathInfo = useMemo(() => parseTenantScopedPath(pathname), [pathname]);
  const inviteTokenFromUrl = sanitizeInviteToken(searchParams.get("invite"));
  const [effectiveInviteToken, setEffectiveInviteToken] = useState(
    inviteTokenFromUrl || readStoredInviteToken()
  );
  const [inviteResolvedContext, setInviteResolvedContext] = useState<
    Awaited<ReturnType<typeof fetchInviteResolvedContext>>
  >(null);
  const [inviteContextLoading, setInviteContextLoading] = useState(false);
  const hasInviteToken = effectiveInviteToken.length > 0;
  const normalizedUserRole = String(user?.role || "").trim().toLowerCase();
  const isGuestUser = normalizedUserRole === "guest" || Boolean(user?.isAnonymous);
  const rawUserName = String(user?.nome || "").trim();
  const isGuestPlaceholderName =
    rawUserName.toLowerCase() === GUEST_PLACEHOLDER_NAME ||
    String(user?.email || "").trim().toLowerCase() === "visitante@usc.app";
  const inviteResolvedTenant = inviteResolvedContext?.tenant ?? null;
  const inviteResolvedTenantSlug = inviteResolvedTenant?.slug?.trim().toLowerCase() || "";
  const effectiveTenantSlug = inviteResolvedTenantSlug || tenantSlug.trim().toLowerCase();
  const effectiveTenantId =
    inviteResolvedTenant?.id?.trim() || tenantId.trim() || String(user?.tenant_id || "").trim();
  const effectiveTenantName = inviteResolvedTenant?.nome?.trim() || tenantName.trim();
  const effectiveTenantSigla = inviteResolvedTenant?.sigla?.trim() || "";
  const inviteTenantLabel =
    effectiveTenantName ||
    effectiveTenantSigla ||
    (effectiveTenantSlug ? effectiveTenantSlug.toUpperCase() : "") ||
    effectiveTenantId ||
    "a atletica do convite";
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false); 
  const [loadingTurmas, setLoadingTurmas] = useState(true);
  const [error, setError] = useState("");
  const [turmasLoadError, setTurmasLoadError] = useState("");
  const [turmas, setTurmas] = useState<TurmaConfig[]>([]);
  const [cadastroConfig, setCadastroConfig] = useState<CadastroConfig>(getDefaultCadastroConfig);
  
  // ðŸ¦ˆ ID 3: Tipagem correta
  const [ufs, setUfs] = useState<IBGEUF[]>([]);
  const [cidades, setCidades] = useState<IBGECity[]>([]);
  const [ufSelected, setUfSelected] = useState("");
  
  // ðŸ¦ˆ ID 1: Estado para travar localização se já existir
  const [locationLocked, setLocationLocked] = useState(false);

  const normalizePhoneToBrE164 = (value: string): string => {
    const digits = value.replace(/\D/g, "");
    const withoutCountry = digits.startsWith("55") ? digits.slice(2) : digits;
    const localDigits = withoutCountry.slice(0, 11);
    return localDigits ? `+55${localDigits}` : "";
  };

  // ðŸ¦ˆ ESTADO TIPADO
  const [formData, setFormData] = useState<UserFormData>({
    nome: "",
    apelido: "",
    matricula: "",
    turma: "",
    instagram: "",
    telefone: "",
    whatsappPublico: true,
    bio: "",
    dataNascimento: "",
    idadePublica: true,
    cidadeOrigem: "",
    estadoOrigem: "", 
    statusRelacionamento: "Solteiro(a)",
    relacionamentoPublico: true,
    esportes: [],
    pets: "nenhum",
    foto: "" 
  });

  const scopedPath = (path: string) =>
    effectiveTenantSlug ? withTenantSlug(effectiveTenantSlug, path) : path;

  const profilePath = user?.uid ? scopedPath(`/perfil/${user.uid}`) : scopedPath("/perfil");
  const pendingPath = scopedPath("/aguardando-aprovacao");
  const landingPath = scopedPath("/");
  const currentRoutePath = routePathInfo.tenantSlug
    ? pathname
    : scopedPath("/cadastro");
  const loginPath = hasInviteToken
    ? `${buildLoginPath(currentRoutePath)}&invite=${encodeURIComponent(effectiveInviteToken)}`
    : buildLoginPath(currentRoutePath);
  const visibleTurmas = useMemo(
    () => turmas.filter((turma) => !turma.hidden || turma.id === formData.turma),
    [formData.turma, turmas]
  );
  const cadastroFields = cadastroConfig.fields;
  const visibleSportOptions = useMemo(
    () => cadastroConfig.sportOptions.filter((option) => option.enabled),
    [cadastroConfig.sportOptions]
  );

  useEffect(() => {
    const nextInviteToken = inviteTokenFromUrl || readStoredInviteToken();
    if (inviteTokenFromUrl) {
      storeInviteToken(inviteTokenFromUrl);
    }
    setEffectiveInviteToken(nextInviteToken);
  }, [inviteTokenFromUrl]);

  useEffect(() => {
    let mounted = true;

    if (!hasInviteToken) {
      setInviteResolvedContext(null);
      setInviteContextLoading(false);
      return () => {
        mounted = false;
      };
    }

    setInviteContextLoading(true);
    const loadInviteContext = async () => {
      try {
        const nextContext = await fetchInviteResolvedContext(effectiveInviteToken);
        if (!mounted) return;
        setInviteResolvedContext(nextContext);
      } catch (loadError) {
        console.error("Erro ao resolver tenant do convite:", loadError);
        if (!mounted) return;
        setInviteResolvedContext(null);
      } finally {
        if (mounted) {
          setInviteContextLoading(false);
        }
      }
    };

    void loadInviteContext();
    return () => {
      mounted = false;
    };
  }, [effectiveInviteToken, hasInviteToken]);

  useEffect(() => {
    if (!hasInviteToken || inviteContextLoading || !inviteResolvedTenantSlug) return;
    if (
      routePathInfo.tenantSlug === inviteResolvedTenantSlug &&
      routePathInfo.scopedPath === "/cadastro"
    ) {
      return;
    }

    router.replace(
      `${withTenantSlug(inviteResolvedTenantSlug, "/cadastro")}?invite=${encodeURIComponent(
        effectiveInviteToken
      )}`
    );
  }, [
    effectiveInviteToken,
    hasInviteToken,
    inviteContextLoading,
    inviteResolvedTenantSlug,
    routePathInfo.scopedPath,
    routePathInfo.tenantSlug,
    router,
  ]);

  useEffect(() => {
    let mounted = true;

    if (!effectiveTenantId) {
      setCadastroConfig(getDefaultCadastroConfig());
      return () => {
        mounted = false;
      };
    }

    const loadCadastroConfig = async () => {
      try {
        const nextConfig = await fetchCadastroConfig({
          tenantId: effectiveTenantId,
          forceRefresh: true,
        });
        if (!mounted) return;
        setCadastroConfig(nextConfig);
      } catch (configError: unknown) {
        console.error("Erro ao carregar configuracao do cadastro:", configError);
        if (!mounted) return;
        setCadastroConfig(getDefaultCadastroConfig());
      }
    };

    void loadCadastroConfig();
    return () => {
      mounted = false;
    };
  }, [effectiveTenantId]);

  // APIs IBGE
  useEffect(() => {
    fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome")
      .then(res => res.json()).then(data => setUfs(data)).catch(console.error);
  }, []);

  useEffect(() => {
    if (ufSelected) {
      fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${ufSelected}/municipios?orderBy=nome`)
        .then(res => res.json()).then(data => setCidades(data)).catch(console.error);
      
      setFormData(prev => ({...prev, estadoOrigem: ufSelected}));
    }
  }, [ufSelected]);

  // ðŸ¦ˆ LOAD DE DADOS COM SANITIZAÃ‡ÃƒO
  useEffect(() => {
    if (user) {
      const resolvedIdentityName =
        isGuestUser && isGuestPlaceholderName ? "" : String(user.nome || "");
      // ðŸ¦ˆ ID 1: Verifica se localização já existe para travar
      if (user.estadoOrigem && user.cidadeOrigem) {
          setLocationLocked(true);
          // Preenche os selects/inputs mesmo travados
          setUfSelected(String(user.estadoOrigem));
      } else if (user.estadoOrigem) {
          setLocationLocked(false);
          setUfSelected(String(user.estadoOrigem));
      } else {
          setLocationLocked(false);
          setUfSelected("");
      }

      setFormData({
        nome: resolvedIdentityName,
        apelido: String(user.apelido || ""),
        matricula: String(user.matricula || ""),
        turma: String(user.turma || ""),
        instagram: String(user.instagram || "").replace("@", ""),
        telefone: normalizePhoneToBrE164(String(user.telefone || "")),
        whatsappPublico: Boolean(user.whatsappPublico ?? true),
        bio: String(user.bio || ""),
        dataNascimento: String(user.dataNascimento || ""),
        idadePublica: Boolean(user.idadePublica ?? true),
        cidadeOrigem: String(user.cidadeOrigem || ""),
        estadoOrigem: String(user.estadoOrigem || ""),
        statusRelacionamento: String(user.statusRelacionamento || "Solteiro(a)"),
        relacionamentoPublico: Boolean(user.relacionamentoPublico ?? true),
        esportes: normalizeSelectedSportIds(Array.isArray(user.esportes) ? user.esportes : []),
        pets: String(user.pets || "nenhum"),
        foto: String(user.foto || "")
      });
    }
  }, [isGuestPlaceholderName, isGuestUser, user]);

  useEffect(() => {
    if (authLoading || user) return;
    router.replace(loginPath);
  }, [authLoading, loginPath, router, user]);

  useEffect(() => {
    setFormData((prev) => {
      const normalizedSports = normalizeSelectedSportIds(
        prev.esportes,
        cadastroConfig.sportOptions
      );
      if (normalizedSports.join("|") === prev.esportes.join("|")) {
        return prev;
      }
      return {
        ...prev,
        esportes: normalizedSports,
      };
    });
  }, [cadastroConfig.sportOptions]);

  useEffect(() => {
    let mounted = true;

    const snapshot =
      readActiveTurmasSnapshot({
        tenantId: effectiveTenantId || undefined,
        tenantSlug: effectiveTenantSlug,
      })?.turmas ?? [];

    if (snapshot.length > 0) {
      setTurmas(snapshot);
    }

    if (!effectiveTenantId && !effectiveTenantSlug) {
      setTurmas(getDefaultTurmas());
      setTurmasLoadError("");
      setLoadingTurmas(false);
      return () => {
        mounted = false;
      };
    }

    const loadTurmas = async () => {
      setLoadingTurmas(true);
      setTurmasLoadError("");
      try {
        const rows = await fetchTurmasConfig({
          tenantId: effectiveTenantId || undefined,
          forceRefresh: true,
        });
        if (!mounted) return;
        setTurmas(rows);
      } catch (loadError: unknown) {
        console.error("Erro ao carregar turmas da tenant:", loadError);
        if (!mounted) return;
        setTurmas(snapshot);
        setTurmasLoadError("Nao foi possivel carregar as turmas desta atletica.");
      } finally {
        if (mounted) {
          setLoadingTurmas(false);
        }
      }
    };

    void loadTurmas();
    return () => {
      mounted = false;
    };
  }, [effectiveTenantId, effectiveTenantSlug]);

  // ðŸ¦ˆ Lógica de Upload de Foto
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      if (!file || imageLoading) {
          input.value = "";
          return;
      }
      const validationError = validateImageFile(file);
      if (validationError) {
          addToast(validationError, "error");
          input.value = "";
          return;
      }

      setImageLoading(true);
      try {
          if (!user?.uid) {
              addToast("Usuario invalido para upload.", "error");
              return;
          }
          const downloadURL = await uploadProfileImage({
              uid: user.uid,
              file,
              kind: "profile",
          });

          setFormData(prev => ({ ...prev, foto: downloadURL }));
          addToast("Foto carregada com sucesso! \uD83E\uDD88", "success");

      } catch (error: unknown) {
          console.error("Erro upload:", error);
          addToast("Erro ao enviar foto. Tente novamente.", "error");
      } finally {
          setImageLoading(false);
          input.value = "";
      }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = normalizePhoneToBrE164(e.target.value);
    setFormData({ ...formData, telefone: value });
  };

  const toggleEsporte = (id: string) => {
      setFormData(prev => {
          const normalizedId = normalizeSelectedSportIds([id], cadastroConfig.sportOptions)[0] || id;
          const exists = prev.esportes.includes(normalizedId);
          const newEsportes = exists
            ? prev.esportes.filter((entry) => entry !== normalizedId)
            : [...prev.esportes, normalizedId];
          return { ...prev, esportes: newEsportes };
      });
  };

  const failValidation = (message: string) => {
    setLoading(false);
    setError(message);
    addToast(message, "error");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (hasInviteToken && inviteContextLoading) {
      failValidation("Ainda estou validando a atletica desse convite. Tente novamente em alguns segundos.");
      return;
    }
    if (hasInviteToken && !inviteResolvedContext) {
      failValidation("Nao consegui identificar a atletica desse convite. Abra novamente o link original.");
      return;
    }
    if (!formData.nome.trim()) {
      failValidation("Campo obrigatorio pendente: nome completo.");
      return;
    }
    if (!formData.apelido.trim()) {
      failValidation("Campo obrigatorio pendente: apelido.");
      return;
    }
    if (!formData.matricula.trim()) {
      failValidation("Campo obrigatorio pendente: matricula.");
      return;
    }
    if (!formData.dataNascimento) {
      failValidation("Campo obrigatorio pendente: data de nascimento.");
      return;
    }
    if (!formData.cidadeOrigem) {
      failValidation("Campo obrigatorio pendente: cidade de origem.");
      return;
    }
    if (!formData.telefone) {
      failValidation("Campo obrigatorio pendente: telefone.");
      return;
    }
    if (!/^\+55\d{10,11}$/.test(formData.telefone)) {
      failValidation("Telefone deve estar no formato +5512912345678.");
      return;
    }
    if (!formData.turma) {
      failValidation("Campo obrigatorio pendente: turma.");
      return;
    }
    if (cadastroFields.instagram.enabled && cadastroFields.instagram.required && !formData.instagram.trim()) {
      failValidation("Campo obrigatorio pendente: Instagram.");
      return;
    }
    if (cadastroFields.bio.enabled && cadastroFields.bio.required && !formData.bio.trim()) {
      failValidation("Campo obrigatorio pendente: bio.");
      return;
    }
    if (
      cadastroFields.statusRelacionamento.enabled &&
      cadastroFields.statusRelacionamento.required &&
      !formData.statusRelacionamento.trim()
    ) {
      failValidation("Campo obrigatorio pendente: status de relacionamento.");
      return;
    }
    if (cadastroFields.pets.enabled && cadastroFields.pets.required && !formData.pets.trim()) {
      failValidation("Campo obrigatorio pendente: mascote.");
      return;
    }
    if (
      cadastroFields.esportes.enabled &&
      cadastroFields.esportes.required &&
      formData.esportes.length === 0
    ) {
      failValidation("Campo obrigatorio pendente: modalidade.");
      return;
    }

    if (!formData.foto) {
      failValidation("Campo obrigatorio pendente: foto de perfil.");
      return;
    }

    try {
      // 1. Atualiza dados do usuário
      const isGuestRole = isGuestUser;
      let inviteJoinFailedMessage = "";

      await updateUser({
        ...formData,
        nome: formData.nome.trim(),
        instagram: formData.instagram ? `@${formData.instagram.replace("@", "")}` : "",
      });

      // ðŸ¦ˆ ID 1: Lógica de Perfil Completo para Gamificação
      // Verifica se todos os campos obrigatórios estão preenchidos
      const isProfileComplete = 
        formData.nome && 
        user?.email && // Email vem do Auth
        formData.turma && 
        formData.telefone &&
        formData.matricula && 
        formData.apelido && 
        formData.cidadeOrigem && 
        formData.estadoOrigem && 
        formData.foto &&
        (!cadastroFields.instagram.enabled || !cadastroFields.instagram.required || Boolean(formData.instagram.trim())) &&
        (!cadastroFields.bio.enabled || !cadastroFields.bio.required || Boolean(formData.bio.trim())) &&
        (
          !cadastroFields.statusRelacionamento.enabled ||
          !cadastroFields.statusRelacionamento.required ||
          Boolean(formData.statusRelacionamento.trim())
        ) &&
        (!cadastroFields.pets.enabled || !cadastroFields.pets.required || Boolean(formData.pets.trim())) &&
        (!cadastroFields.esportes.enabled || !cadastroFields.esportes.required || formData.esportes.length > 0);

      if (isProfileComplete && user?.uid) {
        await markProfileComplete(user.uid);
      }

      // 2. Vinculo tenant por convite (quando vier com ?invite=)
      const currentTenantStatus = String(user?.tenant_status || "").trim().toLowerCase();
      const shouldTryInviteJoin =
        hasInviteToken &&
        currentTenantStatus !== "pending" &&
        currentTenantStatus !== "approved";

      if (shouldTryInviteJoin) {
        try {
          await requestJoinWithInvite(effectiveInviteToken);
        } catch (joinError: unknown) {
          inviteJoinFailedMessage = normalizeInviteJoinFailureMessage(
            extractErrorMessage(joinError)
          );
          const normalizedJoinMessage = inviteJoinFailedMessage.toLowerCase();
          const shouldClearInviteToken =
            normalizedJoinMessage.includes("token invalido") ||
            normalizedJoinMessage.includes("token expirado") ||
            normalizedJoinMessage.includes("convite ja era") ||
            normalizedJoinMessage.includes("inativo");
          if (shouldClearInviteToken) {
            clearStoredInviteToken();
          }
          addToast(inviteJoinFailedMessage, "info");
        }
      } else if (hasInviteToken && (currentTenantStatus === "pending" || currentTenantStatus === "approved")) {
        clearStoredInviteToken();
      }

      // 3. Se estiver pendente, manda para tela de espera
      try {
        const membership = await fetchPendingMembershipStatusForCurrentUser();
        if (membership) {
          const membershipPatch: Parameters<typeof updateUser>[0] = {
            tenant_id: membership.tenantId,
            tenant_role: membership.role,
            tenant_status: membership.status,
          };

          if (isGuestRole && membership.status === "approved") {
            membershipPatch.role = "user";
          }

          await updateUser(membershipPatch);
        }

        if (membership?.status === "pending") {
          clearStoredInviteToken();
          addToast(`Cadastro concluido. ${inviteTenantLabel} vai analisar seu acesso.`, "info");
          router.push(pendingPath);
          return;
        }
        if (membership?.status === "approved") {
          clearStoredInviteToken();
          addToast("Perfil atualizado com sucesso.", "success");
          router.push(profilePath);
          return;
        }
      } catch {
        // Nao bloqueia fluxo principal se esta consulta falhar.
      }

      if (hasInviteToken) {
        const inviteFlowMessage =
          inviteJoinFailedMessage ||
          `Ficha salva, mas ainda nao consegui confirmar sua entrada em ${inviteTenantLabel}. Tente novamente com o mesmo convite.`;
        setError(inviteFlowMessage);
        addToast(inviteFlowMessage, "info");
        return;
      }

      if (isGuestRole) {
        if (!effectiveTenantId) {
          setError(
            inviteJoinFailedMessage || "Escolha uma atletica antes de concluir o cadastro."
          );
          addToast("Escolha a atletica correta para concluir a entrada.", "info");
          return;
        }

        try {
          await requestJoinManual(effectiveTenantId);
          const manualMembership = await fetchPendingMembershipStatusForCurrentUser();
          if (manualMembership) {
            const membershipPatch: Parameters<typeof updateUser>[0] = {
              tenant_id: manualMembership.tenantId,
              tenant_role: manualMembership.role,
              tenant_status: manualMembership.status,
            };
            await updateUser(membershipPatch);

            if (manualMembership.status === "pending") {
              clearStoredInviteToken();
              addToast(
                inviteJoinFailedMessage
                  ? `Convite ignorado. Cadastro enviado para aprovacao de ${inviteTenantLabel}.`
                  : `Cadastro concluido. ${inviteTenantLabel} vai analisar seu acesso.`,
                "info"
              );
              router.push(pendingPath);
              return;
            }

            if (false) {
              await updateUser({ role: "user" });
              clearStoredInviteToken();
              addToast("Perfil atualizado com sucesso.", "success");
              router.push(profilePath);
              return;
            }

            if (manualMembership.status === "approved") {
              await updateUser({ role: "user" });
              clearStoredInviteToken();
              addToast("Perfil atualizado com sucesso.", "success");
              router.push(profilePath);
              return;
            }
          }
        } catch (manualJoinError: unknown) {
          const manualMessage = extractErrorMessage(manualJoinError);
          if (manualMessage.toLowerCase().includes("cadastro publico")) {
            setError(`${inviteTenantLabel} exige convite para novos cadastros.`);
            addToast(`${inviteTenantLabel} exige convite para novos cadastros.`, "info");
          } else {
            setError(inviteJoinFailedMessage || manualMessage);
            addToast(manualMessage, "error");
          }
          return;
        }

        setError(
          inviteJoinFailedMessage ||
            "Ficha salva, mas ainda nao consegui vincular voce a uma atletica."
        );
        addToast("Ficha salva, mas ainda nao consegui concluir o vinculo com a atletica.", "info");
        return;
      }

      clearStoredInviteToken();
      addToast("Perfil atualizado com sucesso.", "success");
      router.push(profilePath); 
    } catch (err: unknown) {
      const errLog =
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : (() => {
              try {
                return JSON.stringify(err);
              } catch {
                return String(err);
              }
            })();
      const safeErrLog =
        errLog === "{}" ? "empty-object error (provavel RLS/policy em public.users)" : errLog;
      console.error(`Erro ao salvar cadastro: ${safeErrLog}`);
      if (isPermissionError(err)) {
        setError("Sem permissao para salvar. Ajuste as policies (RLS) da tabela users no Supabase.");
      } else if (err instanceof Error && err.message.includes("public.users")) {
        setError("Usuario ainda nao encontrado em public.users. Verifique insert/RLS da tabela users.");
      } else if (typeof err === "object" && err !== null && Object.getOwnPropertyNames(err).length === 0) {
        setError("Falha ao salvar no banco (erro vazio {}). Geralmente e policy/RLS da tabela users.");
      } else {
        setError("Erro ao salvar no QG.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExit = async () => {
    await logout();
    router.replace(landingPath);
  };

  if (!authLoading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white p-4 pb-20 flex flex-col items-center overflow-hidden">
        
        {/* LOGO FUNDO */}
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none opacity-5 z-0">
            <Image src="/logo.png" alt="Logo Fundo" fill className="object-contain" />
        </div>

        {/* BOTÒO DE RETORNO */}
        <div className="w-full max-w-3xl flex justify-start mb-4 relative z-20">
            <Link href={profilePath} className="bg-zinc-900 border border-zinc-800 p-3 rounded-full hover:bg-zinc-800 transition text-zinc-400 hover:text-white flex items-center gap-2 text-xs font-bold uppercase">
                <ArrowLeft size={18}/> Voltar ao Perfil
            </Link>
            <button
                type="button"
                onClick={() => {
                  void handleExit();
                }}
                className="ml-2 bg-zinc-900 border border-zinc-800 p-3 rounded-full hover:bg-zinc-800 transition text-zinc-400 hover:text-white text-xs font-bold uppercase"
            >
                Sair
            </button>
        </div>

        <div className="w-full max-w-3xl bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 p-6 md:p-10 rounded-[2.5rem] shadow-2xl relative z-10">
            
            <div className="text-center mb-8">
                {/* ðŸ¦ˆ UPLOAD DE FOTO */}
                <div className="relative w-32 h-32 mx-auto mb-4 group">
                    <div className="relative w-full h-full rounded-full border-4 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)] overflow-hidden bg-zinc-800">
                        {imageLoading ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
                                <Loader2 className="animate-spin text-emerald-500" size={32}/>
                            </div>
                        ) : (
                            <Image 
                                src={formData.foto || "https://github.com/shadcn.png"} 
                                alt="Avatar" 
                                fill
                                className="object-cover" 
                                
                            />
                        )}
                        
                        {/* Overlay de Edição */}
                        <label className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10 backdrop-blur-[2px]">
                            <Camera className="text-white mb-1" size={24}/>
                            <span className="text-[10px] uppercase font-bold text-white tracking-widest">Alterar</span>
                            <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp" disabled={imageLoading} onChange={handleImageUpload} />
                        </label>
                    </div>
                    {/* Botão flutuante mobile */}
                    <label className="absolute bottom-0 right-0 bg-emerald-600 p-2 rounded-full border-2 border-[#050505] shadow-lg cursor-pointer md:hidden z-30">
                        <UploadCloud size={16} className="text-white"/>
                        <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp" disabled={imageLoading} onChange={handleImageUpload} />
                    </label>
                </div>

                <h1 className="text-3xl font-black uppercase italic tracking-tighter text-emerald-500">Cadastro</h1>
                {/* AVISO DE FOTO */}
                <div className="mt-4 bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-xl max-w-sm mx-auto">
                    <p className="text-[10px] text-yellow-400 font-bold uppercase tracking-wide flex items-center justify-center gap-2">
                        <ShieldAlert size={14}/> Atencao: Use sua foto real!
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-1">
                        Perfis com fotos fake, desenhos ou conteudo improprio serao <span className="text-red-400 font-bold underline">bloqueados</span> sem aviso.
                    </p>
                    <p className="text-[10px] text-zinc-300 mt-2">
                        Se for trocar a foto, reduza antes no <span className="font-black text-emerald-300">Squash App</span> para ate <span className="font-black text-emerald-400">200 KB</span>.
                    </p>
                </div>
            </div>

            {error && <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm font-bold flex items-center gap-2 animate-pulse"><ShieldAlert size={18}/> {error}</div>}

            <form onSubmit={handleSubmit} className="space-y-8">
                
                {/* BLOCO 1: IDENTIDADE */}
                <div className="space-y-4">
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 block border-b border-zinc-800 pb-1">Identidade</label>

                    {hasInviteToken ? (
                    <div className="relative group opacity-80">
                        <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-cyan-300" size={18} />
                        <input
                          type="text"
                          className="input-field pl-14 cursor-not-allowed bg-zinc-950 text-cyan-100"
                          value={inviteContextLoading ? "Validando atletica do convite..." : inviteTenantLabel}
                          readOnly
                          title="Atletica travada pelo convite."
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600">
                            <Lock size={14}/>
                        </div>
                    </div>
                    ) : null}
                    
                    {isGuestUser ? (
                    <div className="relative group">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition" size={18} />
                        <input
                          type="text"
                          placeholder="Nome Completo"
                          className="input-field pl-14"
                          value={formData.nome}
                          onChange={e => setFormData({ ...formData, nome: e.target.value })}
                          maxLength={120}
                          required
                        />
                    </div>
                    ) : (
                    <div className="relative group opacity-60">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                        <input type="text" placeholder="Nome Completo" className="input-field pl-14 cursor-not-allowed bg-zinc-950" value={formData.nome} readOnly title="Nome oficial nao pode ser alterado aqui." />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600">
                            <Lock size={14}/> 
                        </div>
                    </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative group">
                            <BadgeCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition" size={18} />
                            <input type="text" placeholder="Apelido (Como quer ser chamado)" className="input-field pl-14" value={formData.apelido} onChange={e => setFormData({...formData, apelido: e.target.value})} maxLength={20} required />
                        </div>

                        <div className="relative group">
                            <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition" size={18} />
                            <input type="text" placeholder="No. Matricula" className="input-field pl-14" value={formData.matricula} onChange={e => setFormData({...formData, matricula: e.target.value.replace(/\D/g, "")})} required />
                        </div>
                    </div>

                    <div className={`grid grid-cols-1 gap-4 ${cadastroFields.statusRelacionamento.enabled ? "md:grid-cols-2" : ""}`}>
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <BirthDateField
                                  value={formData.dataNascimento}
                                  onChange={(value) => setFormData((prev) => ({ ...prev, dataNascimento: value }))}
                                />
                            </div>
                            <button 
                                type="button" 
                                onClick={() => setFormData({...formData, idadePublica: !formData.idadePublica})} 
                                className={`w-14 rounded-xl border flex items-center justify-center transition-all ${formData.idadePublica ? "bg-zinc-800 border-zinc-700 text-zinc-500" : "bg-zinc-800 border-red-500/50 text-red-400"}`}
                                title={formData.idadePublica ? "Idade Visivel" : "Idade Oculta"}
                            >
                                {formData.idadePublica ? <Eye size={20} /> : <EyeOff size={20} />}
                            </button>
                        </div>

                        {cadastroFields.statusRelacionamento.enabled ? (
                        <div className="flex gap-2">
                            <div className="relative flex-1 group">
                                <Heart className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-pink-500" size={18} />
                                <select className="input-field pl-14 flex-1 appearance-none" value={formData.statusRelacionamento} onChange={e => setFormData({...formData, statusRelacionamento: e.target.value})}>
                                    {DEFAULT_STATUS_RELACIONAMENTO_OPTIONS.map((status) => (
                                      <option key={status} value={status}>{status}</option>
                                    ))}
                                </select>
                            </div>
                            <button type="button" onClick={() => setFormData({...formData, relacionamentoPublico: !formData.relacionamentoPublico})} className={`w-14 rounded-xl border flex items-center justify-center transition-all ${formData.relacionamentoPublico ? "bg-pink-500/20 border-pink-500/50 text-pink-500" : "bg-zinc-800 border-zinc-700 text-zinc-500"}`}>
                                {formData.relacionamentoPublico ? <Eye size={20} /> : <EyeOff size={20} />}
                            </button>
                        </div>
                        ) : null}
                    </div>

                    {/* ðŸ¦ˆ ID 1: LOCALIZAÃ‡ÃƒO - Travar se já existir */}
                    {locationLocked ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Estado Locked */}
                            <div className="relative group opacity-60">
                                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                                <input type="text" value={formData.estadoOrigem} className="input-field pl-14 cursor-not-allowed bg-zinc-950" readOnly title="Estado de origem ja registrado." />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600">
                                    <Lock size={14}/> 
                                </div>
                            </div>
                            {/* Cidade Locked */}
                            <div className="relative group opacity-60">
                                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                                <input type="text" value={formData.cidadeOrigem} className="input-field pl-14 cursor-not-allowed bg-zinc-950" readOnly title="Cidade de origem ja registrada." />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600">
                                    <Lock size={14}/> 
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Adicionado 'px-4' pois este select não tem ícone, evitando que o texto cole na borda */}
                            <select className="input-field px-4" value={ufSelected} onChange={e => setUfSelected(e.target.value)} required>
                                <option value="">Estado de Origem</option>
                                {ufs.map(uf => <option key={uf.id} value={uf.sigla}>{uf.nome}</option>)}
                            </select>
                            <div className="relative group">
                                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                                <select className="input-field pl-14 appearance-none" value={formData.cidadeOrigem} onChange={e => setFormData({...formData, cidadeOrigem: e.target.value})} disabled={!ufSelected} required>
                                    <option value="">Cidade</option>
                                    {cidades.map(city => <option key={city.id} value={city.nome}>{city.nome}</option>)}
                                </select>
                            </div>
                        </div>
                    )}

                    <div className={`grid grid-cols-1 gap-4 ${cadastroFields.instagram.enabled ? "md:grid-cols-2" : ""}`}>
                        <div className="flex gap-2">
                            <div className="relative flex-1 group">
                                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                                <input
                                    type="tel"
                                    placeholder="+5512912345678"
                                    className="input-field pl-14"
                                    value={formData.telefone}
                                    onChange={handlePhoneChange}
                                    inputMode="numeric"
                                    autoComplete="tel"
                                    required
                                />
                            </div>
                            <button type="button" onClick={() => setFormData({...formData, whatsappPublico: !formData.whatsappPublico})} className={`w-14 rounded-xl border flex items-center justify-center transition-all ${formData.whatsappPublico ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-500" : "bg-zinc-800 border-zinc-700 text-zinc-500"}`}>
                                {formData.whatsappPublico ? <Eye size={20} /> : <EyeOff size={20} />}
                            </button>
                        </div>
                        {cadastroFields.instagram.enabled ? (
                        <div className="relative group">
                            <Instagram className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-pink-500 transition" size={18} />
                            <input
                              type="text"
                              maxLength={120}
                              placeholder={cadastroFields.instagram.required ? "Insta obrigatorio (sem @)" : "Insta (sem @)"}
                              className="input-field pl-14"
                              value={formData.instagram}
                              onChange={e => setFormData({...formData, instagram: e.target.value.slice(0, 120)})}
                            />
                        </div>
                        ) : null}
                    </div>
                </div>

                {/* BLOCO 2: PETS */}
                {cadastroFields.pets.enabled ? (
                <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 block border-b border-zinc-800 pb-1 flex items-center gap-2">
                        <PawPrint size={12} className="text-orange-500"/> Mascote do QG
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {DEFAULT_PET_OPTIONS.map((pet) => (
                            <button
                                key={pet.id}
                                type="button"
                                onClick={() => setFormData({ ...formData, pets: pet.id })}
                                className={`relative p-3 rounded-xl border transition-all duration-200 flex flex-col items-center gap-1 group ${
                                    formData.pets === pet.id
                                    ? "bg-orange-500/20 border-orange-500 text-white shadow-[0_0_15px_rgba(249,115,22,0.2)]" 
                                    : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:border-zinc-700"
                                }`}
                            >
                                <span className="text-xl group-hover:scale-110 transition duration-300">{pet.icon}</span>
                                <span className={`text-[10px] font-bold uppercase ${formData.pets === pet.id ? "text-orange-400" : "text-zinc-500"}`}>{pet.label}</span>
                                {formData.pets === pet.id && <div className="absolute top-1 right-1"><CheckCircle2 size={12} className="text-orange-500"/></div>}
                            </button>
                        ))}
                    </div>
                </div>
                ) : null}

                {/* BLOCO 3: ESPORTES */}
                {cadastroFields.esportes.enabled ? (
                <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 block border-b border-zinc-800 pb-1 flex items-center gap-2">
                        <Trophy size={12} className="text-emerald-500"/> Suas Modalidades
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {visibleSportOptions.map((esp) => {
                            const isSelected = formData.esportes.includes(esp.id);
                            return (
                                <button
                                    key={esp.id}
                                    type="button"
                                    onClick={() => toggleEsporte(esp.id)}
                                    className={`relative p-3 rounded-xl border transition-all duration-200 flex flex-col items-center gap-1 group ${
                                        isSelected 
                                        ? "bg-emerald-500/20 border-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.2)]" 
                                        : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:border-zinc-700"
                                    }`}
                                >
                                    <span className="text-xl group-hover:scale-110 transition duration-300">{esp.icon}</span>
                                    <span className={`text-[10px] font-bold uppercase ${isSelected ? "text-emerald-400" : "text-zinc-500"}`}>{esp.label}</span>
                                    {isSelected && <div className="absolute top-1 right-1"><CheckCircle2 size={12} className="text-emerald-500"/></div>}
                                </button>
                            )
                        })}
                    </div>
                </div>
                ) : null}

                {/* BLOCO 4: TURMA */}
                <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 block border-b border-zinc-800 pb-1">Selecione sua turma</label>
                    <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                        {loadingTurmas ? (
                            <div className="rounded-2xl border border-zinc-800 bg-black/40 px-4 py-6 text-sm font-semibold text-zinc-400 flex items-center gap-3">
                                <Loader2 className="animate-spin text-emerald-500" size={18} />
                                Carregando turmas da sua atletica...
                            </div>
                        ) : null}
                        {!loadingTurmas && turmasLoadError ? (
                            <div className="rounded-2xl border border-red-500/20 bg-red-950/20 px-4 py-3 text-xs font-semibold text-red-300">
                                {turmasLoadError}
                            </div>
                        ) : null}
                        {!loadingTurmas && visibleTurmas.length === 0 ? (
                            <div className="rounded-2xl border border-zinc-800 bg-black/40 px-4 py-6 text-sm font-semibold text-zinc-400">
                                Nenhuma turma visivel foi configurada para esta tenant.
                            </div>
                        ) : null}
                        {visibleTurmas.map((t, index) => {
                            const turmaTitle = [t.nome.trim(), t.mascote.trim()]
                                .filter((value) => value.length > 0)
                                .join(" - ");

                            return (
                            <div key={t.id} onClick={() => setFormData({...formData, turma: t.id})} className={`cursor-pointer rounded-2xl border p-4 flex items-center justify-between transition-all ${formData.turma === t.id ? "bg-emerald-500/10 border-emerald-500" : "bg-black/40 border-zinc-800 hover:bg-zinc-800"}`}>
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden relative">
                                        {/* ðŸ¦ˆ 1. Correção: Uso do Image do Next.js */}
                                        <Image 
                                            src={getTurmaImage(t.id, t.logo || "/logo.png")} 
                                            alt={turmaTitle || t.id} 
                                            fill 
                                            className="object-cover" 
                                            
                                            priority={index < 2}
                                        />
                                    </div>
                                    <span className={`text-sm font-bold uppercase ${formData.turma === t.id ? "text-emerald-400" : "text-zinc-400"}`}>{turmaTitle || t.id}</span>
                                </div>
                                {formData.turma === t.id && <CheckCircle2 className="text-emerald-500" size={20} />}
                            </div>
                            );
                        })}
                    </div>
                </div>

                {/* BIO */}
                {cadastroFields.bio.enabled ? (
                <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 block border-b border-zinc-800 pb-1">Bio</label>
                    <div className="relative group">
                        <FileText className="absolute left-4 top-4 text-zinc-500" size={18} />
                        <textarea placeholder="Conte algo sobre voce..." className="input-field pl-14 h-24 py-3 resize-none" value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} maxLength={100} />
                        <span className="absolute right-4 bottom-2 text-[10px] text-zinc-700 font-bold">{formData.bio.length}/100</span>
                    </div>
                </div>
                ) : null}
                
                <button type="submit" disabled={loading || imageLoading || inviteContextLoading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase py-5 rounded-[2rem] shadow-xl shadow-emerald-900/20 transition-all flex justify-center items-center gap-2 disabled:cursor-not-allowed disabled:opacity-70">
                    {loading ? <Loader2 className="animate-spin"/> : <Save size={20} />}
                    {loading ? "Gravando Ficha..." : "Finalizar & Ir pro Perfil"}
                </button>

            </form>
        </div>

        <style jsx>{`
            .input-field { 
                width: 100%; 
                background: #000; 
                border: 1px solid #27272a; 
                border-radius: 1.25rem; 
                color: white; 
                padding-right: 1rem; /* Apenas direita */
                outline: none; 
                transition: 0.3s; 
                height: 3.5rem; 
                font-size: 0.875rem; 
                font-weight: 600; 
            }
            .input-field:focus { border-color: #10b981; box-shadow: 0 0 15px rgba(16, 185, 129, 0.1); }
            textarea.input-field { height: auto; }
            .custom-scrollbar::-webkit-scrollbar { width: 4px; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background: #10b981; border-radius: 10px; }
        `}</style>
    </div>
  );
}

