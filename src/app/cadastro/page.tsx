// src/app/cadastro/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { 
  User, Hash, Instagram, FileText, Phone, Save, Loader2, ShieldAlert, 
  Eye, EyeOff, CheckCircle2, MapPin, Calendar, Heart, Trophy, PawPrint, 
  ArrowLeft, BadgeCheck, Lock, Camera, UploadCloud 
} from "lucide-react";
import { useAuth } from "../../context/AuthContext"; 
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { markProfileComplete, uploadProfileImage } from "../../lib/profileService";
import { validateImageFile } from "../../lib/upload";
import { isPermissionError } from "../../lib/backendErrors";
import { useToast } from "../../context/ToastContext"; 
import { getTurmaImage } from "../../constants/turmaImages";
import {
  fetchPendingMembershipStatusForCurrentUser,
  requestJoinWithInvite,
} from "../../lib/tenantService";

// --- DADOS ---
const TURMAS = [
  { id: "T1", nome: "Turma I - Jacare", img: getTurmaImage("T1") },
  { id: "T2", nome: "Turma II - Cavalo Marinho", img: getTurmaImage("T2") },
  { id: "T3", nome: "Turma III - Tartaruga", img: getTurmaImage("T3") },
  { id: "T4", nome: "Turma IV - Baleia", img: getTurmaImage("T4") },
  { id: "T5", nome: "Turma V - Pinguim", img: getTurmaImage("T5") }, 
  { id: "T6", nome: "Turma VI - Lagosta", img: getTurmaImage("T6") },
  { id: "T7", nome: "Turma VII - Urso Polar", img: getTurmaImage("T7") },
  { id: "T8", nome: "Turma VIII - Calouro", img: getTurmaImage("T8") },
  { id: "T9", nome: "Turma IX", img: getTurmaImage("T9") },
];

const STATUS_RELACIONAMENTO = ["Solteiro(a)", "Namorando", "Casado(a)", "Enrolado(a)", "No QG da Atletica"];

const ESPORTES_OPTIONS = [
    { id: "futebol", label: "Futebol", icon: "\u26BD" },
    { id: "futsal", label: "Futsal", icon: "\uD83D\uDC5F" },
    { id: "volei", label: "Volei", icon: "\uD83C\uDFD0" },
    { id: "basquete", label: "Basquete", icon: "\uD83C\uDFC0" },
    { id: "handball", label: "Handball", icon: "\uD83E\uDD3E" },
    { id: "rugby", label: "Rugby", icon: "\uD83C\uDFC9" },
    { id: "baseball", label: "Baseball", icon: "\u26BE" },
    { id: "futevolei", label: "Futevolei", icon: "\uD83C\uDFD0" },
    { id: "beach_tennis", label: "Beach Tennis", icon: "\uD83C\uDFD6\uFE0F" },
    { id: "tenis", label: "Tenis", icon: "\uD83C\uDFBE" },
    { id: "frescobol", label: "Frescobol", icon: "\uD83C\uDFD3" },
    { id: "taco", label: "Taco (Bets)", icon: "\uD83C\uDFCF" },
    { id: "peteca", label: "Peteca", icon: "\uD83C\uDFF8" },
    { id: "surf", label: "Surf", icon: "\uD83C\uDFC4" },
    { id: "natacao", label: "Natacao", icon: "\uD83C\uDFCA" },
    { id: "canoagem", label: "Canoagem", icon: "\uD83D\uDEF6" },
    { id: "skate", label: "Skate", icon: "\uD83D\uDEF9" },
    { id: "dog_walking", label: "Dog Walking", icon: "\uD83D\uDC15" },
    { id: "truco", label: "Truco", icon: "\uD83C\uDCCF" },
    { id: "sinuca", label: "Sinuca", icon: "\uD83C\uDFB1" },
];

const PETS_OPTIONS = [
    { id: "cachorro", label: "Cachorro", icon: "\uD83D\uDC36" },
    { id: "gato", label: "Gato", icon: "\uD83D\uDC31" },
    { id: "ambos", label: "Ambos", icon: "\uD83D\uDC36\uD83D\uDC31" },
    { id: "nenhum", label: "Sem Pet", icon: "\uD83D\uDEAB" },
];

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

export default function CadastroPage() {
  const { user, updateUser, logout, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = (searchParams.get("invite") || "").trim();
  const hasInviteToken = inviteToken.length > 0;
  
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false); 
  const [error, setError] = useState("");
  
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
      // ðŸ¦ˆ ID 1: Verifica se localização já existe para travar
      if (user.estadoOrigem && user.cidadeOrigem) {
          setLocationLocked(true);
          // Preenche os selects/inputs mesmo travados
          setUfSelected(String(user.estadoOrigem));
      } else if (user.estadoOrigem) {
          setUfSelected(String(user.estadoOrigem));
      }

      setFormData({
        nome: String(user.nome || ""),
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
        esportes: Array.isArray(user.esportes) ? user.esportes : [],
        pets: String(user.pets || "nenhum"),
        foto: String(user.foto || "")
      });
    }
  }, [user]);

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
          const exists = prev.esportes.includes(id);
          const newEsportes = exists ? prev.esportes.filter(e => e !== id) : [...prev.esportes, id];
          return { ...prev, esportes: newEsportes };
      });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!formData.apelido.trim()) { setLoading(false); return setError("O 'Apelido' e obrigatorio, soldado!"); }
    if (!formData.matricula.trim()) { setLoading(false); return setError("A matricula e obrigatoria!"); }
    if (!formData.dataNascimento) { setLoading(false); return setError("Data de nascimento e necessaria!"); }
    if (!formData.cidadeOrigem) { setLoading(false); return setError("Selecione sua cidade de origem!"); }
    if (!formData.telefone) { setLoading(false); return setError("Telefone e obrigatorio para contato!"); }
    if (!/^\+55\d{10,11}$/.test(formData.telefone)) { setLoading(false); return setError("Telefone deve estar no formato +5512912345678."); }
    if (!formData.turma) { setLoading(false); return setError("Selecione sua turma!"); }
    
    if (!formData.foto) { setLoading(false); return setError("A foto de perfil e obrigatoria!"); }

    try {
      // 1. Atualiza dados do usuário
      await updateUser({
        ...formData,
        instagram: formData.instagram ? `@${formData.instagram.replace("@", "")}` : "",
        role: user?.role === 'guest' ? 'user' : user?.role 
      });

      // ðŸ¦ˆ ID 1: Lógica de Perfil Completo para Gamificação
      // Verifica se todos os campos obrigatórios estão preenchidos
      const isProfileComplete = 
        formData.nome && 
        user?.email && // Email vem do Auth
        formData.turma && 
        formData.instagram && 
        formData.telefone &&
        formData.matricula && 
        formData.apelido && 
        formData.cidadeOrigem && 
        formData.estadoOrigem && 
        formData.foto;

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
          await requestJoinWithInvite(inviteToken);
        } catch (joinError: unknown) {
          const joinMessage = extractErrorMessage(joinError);
          setError(`Cadastro salvo, mas o convite falhou: ${joinMessage}`);
          addToast("Cadastro salvo, mas o convite nao foi aplicado.", "error");
          return;
        }
      }

      // 3. Se estiver pendente, manda para tela de espera
      try {
        const membership = await fetchPendingMembershipStatusForCurrentUser();
        if (membership?.status === "pending") {
          await updateUser({
            tenant_id: membership.tenantId,
            tenant_role: membership.role,
            tenant_status: membership.status,
          });
          addToast("Cadastro concluido. Aguarde aprovacao da atletica.", "info");
          router.push("/aguardando-aprovacao");
          return;
        }
        if (membership?.status === "approved") {
          await updateUser({
            tenant_id: membership.tenantId,
            tenant_role: membership.role,
            tenant_status: membership.status,
          });
        }
      } catch {
        // Nao bloqueia fluxo principal se esta consulta falhar.
      }

      addToast("Perfil atualizado! Bem-vindo ao cardume. \uD83E\uDD88", "success");
      router.push("/perfil"); 
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

  if (!authLoading && !user) { router.push("/"); return null; }

  return (
    <div className="min-h-screen bg-[#050505] text-white p-4 pb-20 flex flex-col items-center overflow-hidden">
        
        {/* LOGO FUNDO */}
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none opacity-5 z-0">
            <Image src="/logo.png" alt="Logo Fundo" fill className="object-contain" />
        </div>

        {/* BOTÒO DE RETORNO */}
        <div className="w-full max-w-3xl flex justify-start mb-4 relative z-20">
            <Link href="/perfil" className="bg-zinc-900 border border-zinc-800 p-3 rounded-full hover:bg-zinc-800 transition text-zinc-400 hover:text-white flex items-center gap-2 text-xs font-bold uppercase">
                <ArrowLeft size={18}/> Voltar ao Perfil
            </Link>
            <button
                type="button"
                onClick={() => { void logout(); }}
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

                <h1 className="text-3xl font-black uppercase italic tracking-tighter">Ficha do <span className="text-emerald-500">Tubarao</span></h1>
                {hasInviteToken && (
                    <div className="mt-3 bg-cyan-500/10 border border-cyan-500/20 p-3 rounded-xl max-w-xl mx-auto">
                        <p className="text-[10px] text-cyan-300 font-bold uppercase tracking-wide">
                            Convite detectado: ao concluir, seu acesso fica aguardando aprovacao.
                        </p>
                    </div>
                )}
                
                {/* AVISO DE FOTO */}
                <div className="mt-4 bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-xl max-w-sm mx-auto">
                    <p className="text-[10px] text-yellow-400 font-bold uppercase tracking-wide flex items-center justify-center gap-2">
                        <ShieldAlert size={14}/> Atencao: Use sua foto real!
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-1">
                        Perfis com fotos fake, desenhos ou conteudo improprio serao <span className="text-red-400 font-bold underline">bloqueados</span> sem aviso.
                    </p>
                </div>
            </div>

            {error && <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm font-bold flex items-center gap-2 animate-pulse"><ShieldAlert size={18}/> {error}</div>}

            <form onSubmit={handleSubmit} className="space-y-8">
                
                {/* BLOCO 1: IDENTIDADE */}
                <div className="space-y-4">
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 block border-b border-zinc-800 pb-1">Identidade</label>
                    
                    {/* NOME COMPLETO (TRAVADO) */}
                    <div className="relative group opacity-60">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                        <input type="text" placeholder="Nome Completo" className="input-field pl-14 cursor-not-allowed bg-zinc-950" value={formData.nome} readOnly title="Nome oficial nao pode ser alterado aqui." />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600">
                            <Lock size={14}/> 
                        </div>
                    </div>

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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex gap-2">
                             <div className="relative group flex-1">
                                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                                <input type="date" className="input-field pl-14" value={formData.dataNascimento} onChange={e => setFormData({...formData, dataNascimento: e.target.value})} required />
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

                        <div className="flex gap-2">
                            <div className="relative flex-1 group">
                                <Heart className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-pink-500" size={18} />
                                <select className="input-field pl-14 flex-1 appearance-none" value={formData.statusRelacionamento} onChange={e => setFormData({...formData, statusRelacionamento: e.target.value})}>
                                    {STATUS_RELACIONAMENTO.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <button type="button" onClick={() => setFormData({...formData, relacionamentoPublico: !formData.relacionamentoPublico})} className={`w-14 rounded-xl border flex items-center justify-center transition-all ${formData.relacionamentoPublico ? "bg-pink-500/20 border-pink-500/50 text-pink-500" : "bg-zinc-800 border-zinc-700 text-zinc-500"}`}>
                                {formData.relacionamentoPublico ? <Eye size={20} /> : <EyeOff size={20} />}
                            </button>
                        </div>
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        <div className="relative group">
                            <Instagram className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-pink-500 transition" size={18} />
                            <input type="text" placeholder="Insta (sem @)" className="input-field pl-14" value={formData.instagram} onChange={e => setFormData({...formData, instagram: e.target.value})} />
                        </div>
                    </div>
                </div>

                {/* BLOCO 2: PETS */}
                <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 block border-b border-zinc-800 pb-1 flex items-center gap-2">
                        <PawPrint size={12} className="text-orange-500"/> Mascote do QG
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {PETS_OPTIONS.map((pet) => (
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

                {/* BLOCO 3: ESPORTES */}
                <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 block border-b border-zinc-800 pb-1 flex items-center gap-2">
                        <Trophy size={12} className="text-emerald-500"/> Suas Modalidades
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {ESPORTES_OPTIONS.map((esp) => {
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

                {/* BLOCO 4: TURMA */}
                <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 block border-b border-zinc-800 pb-1">Selecione seu Cardume</label>
                    <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                        {TURMAS.map((t) => (
                            <div key={t.id} onClick={() => setFormData({...formData, turma: t.id})} className={`cursor-pointer rounded-2xl border p-4 flex items-center justify-between transition-all ${formData.turma === t.id ? "bg-emerald-500/10 border-emerald-500" : "bg-black/40 border-zinc-800 hover:bg-zinc-800"}`}>
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden relative">
                                        {/* ðŸ¦ˆ 1. Correção: Uso do Image do Next.js */}
                                        <Image 
                                            src={getTurmaImage(t.id)} 
                                            alt={t.nome} 
                                            fill 
                                            className="object-cover" 
                                            
                                            priority={t.id === "T1" || t.id === "T2"}
                                        />
                                    </div>
                                    <span className={`text-sm font-bold uppercase ${formData.turma === t.id ? "text-emerald-400" : "text-zinc-400"}`}>{t.nome}</span>
                                </div>
                                {formData.turma === t.id && <CheckCircle2 className="text-emerald-500" size={20} />}
                            </div>
                        ))}
                    </div>
                </div>

                {/* BIO */}
                <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest ml-2 block border-b border-zinc-800 pb-1">Grito de Guerra (Bio do Album)</label>
                    <div className="relative group">
                        <FileText className="absolute left-4 top-4 text-zinc-500" size={18} />
                        <textarea placeholder="Conte algo sobre voce..." className="input-field pl-14 h-24 py-3 resize-none" value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} maxLength={100} />
                        <span className="absolute right-4 bottom-2 text-[10px] text-zinc-700 font-bold">{formData.bio.length}/100</span>
                    </div>
                </div>
                
                <button type="submit" disabled={loading || imageLoading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase py-5 rounded-[2rem] shadow-xl shadow-emerald-900/20 transition-all flex justify-center items-center gap-2">
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

