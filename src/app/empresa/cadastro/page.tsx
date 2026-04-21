"use client";

import React, { useState, useEffect } from "react";
import { 
  ArrowLeft, Store, Mail, Lock, FileText, Phone, Tag, 
  CheckCircle, ChevronRight, Crown, Star, Shield, User, CreditCard, Loader2 
} from "lucide-react";
// 🦈 Link removido pois não estava em uso (usamos router.push)
import Image from "next/image"; // 🦈 Importando Image
import { useRouter } from "next/navigation";
import { useToast } from "../../../context/ToastContext";
import { useAuth } from "../../../context/AuthContext";
import { createPartnerLead } from "../../../lib/partnersService";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";

const PLANOS = [
    { id: 'ouro', nome: 'Ouro', valor: 'R$ 500', icon: Crown, color: 'text-yellow-500', border: 'border-yellow-500/50', bg: 'bg-yellow-500/10' },
    { id: 'prata', nome: 'Prata', valor: 'R$ 250', icon: Star, color: 'text-zinc-300', border: 'border-zinc-500/50', bg: 'bg-zinc-500/10' },
    { id: 'standard', nome: 'Standard', valor: 'Grátis', icon: Shield, color: 'text-emerald-500', border: 'border-emerald-500/50', bg: 'bg-emerald-500/10' },
];

const keepDigits = (value: string, maxDigits: number): string =>
  value.replace(/\D/g, "").slice(0, maxDigits);

const formatCnpjInput = (value: string): string => {
  const digits = keepDigits(value, 14);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

const formatCpfInput = (value: string): string => {
  const digits = keepDigits(value, 11);
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

const formatPhoneInput = (value: string): string => {
  const digits = keepDigits(value, 13);
  if (!digits) return "";
  if (digits.length <= 2) return digits;

  const country = digits.slice(0, 2);
  if (digits.length <= 4) return `${country} (${digits.slice(2)}`;

  const ddd = digits.slice(2, 4);
  const number = digits.slice(4);
  if (!number) return `${country} (${ddd})`;
  if (number.length <= 4) return `${country} (${ddd}) ${number}`;
  if (number.length <= 8) return `${country} (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  return `${country} (${ddd}) ${number.slice(0, 5)}-${number.slice(5, 9)}`;
};

export default function CompanyRegisterPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { user } = useAuth(); // ID 56: Verifica login
  const { tenantId, tenantLogoUrl, tenantName, tenantSlug } = useTenantTheme();
  
  // 1: Planos, 2: Dados, 3: Perfil
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("");
  
  const [formData, setFormData] = useState({
    nome: "", cnpj: "", 
    responsavel: "", cpf: "", 
    categoria: "Alimentação", email: "", telefone: "", senha: "", confirmSenha: "",
    descricao: "", endereco: "", horario: ""
  });

  // ID 56: Redireciona se já logado como parceiro
  const handleMaskedInputChange = (
    field: "cnpj" | "cpf" | "telefone",
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const rawValue = event.target.value;
    const formatted =
      field === "cnpj"
        ? formatCnpjInput(rawValue)
        : field === "cpf"
          ? formatCpfInput(rawValue)
          : formatPhoneInput(rawValue);

    setFormData((prev) => ({ ...prev, [field]: formatted }));
  };

  useEffect(() => {
      if (user && user.role === 'partner') {
          addToast("Você já está logado!", "info");
          router.push(tenantSlug ? withTenantSlug(tenantSlug, "/empresa") : "/empresa");
      }
  }, [user, addToast, router, tenantSlug]); // 🦈 Dependências adicionadas

  // ID 79: Lógica do Botão Voltar
  const handleBack = (e: React.MouseEvent) => {
      e.preventDefault();
      if (user) {
          // Se está logado (Aluno ou Admin), volta para a lista de parceiros
          router.push(tenantSlug ? withTenantSlug(tenantSlug, "/parceiros") : "/parceiros");
      } else {
          // Se não está logado, volta para a Home pública
          router.push(tenantSlug ? `/${tenantSlug}` : "/");
      }
  };

  const handleSelectPlan = (planId: string) => {
      setSelectedPlan(planId);
      setStep(2);
  };

  // ID 55: Validações
  const validateStep2 = () => {
      const cleanCNPJ = formData.cnpj.replace(/\D/g, '');
      const cleanCPF = formData.cpf.replace(/\D/g, '');
      const cleanPhone = formData.telefone.replace(/\D/g, '');

      if (!formData.nome) return "Nome Fantasia é obrigatório.";
      if (cleanCNPJ.length !== 14) return "CNPJ inválido (14 dígitos).";
      if (!formData.responsavel) return "Nome do Responsável obrigatório.";
      if (cleanCPF.length !== 11) return "CPF inválido (11 dígitos).";
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email) || !formData.email.includes(".com")) return "Email inválido.";

      if (cleanPhone.length < 12 || cleanPhone.length > 13) return "Telefone inválido (use 55 + DDD + Número).";

      if (formData.senha.length < 8) return "A senha deve ter no mínimo 8 caracteres.";
      if (formData.senha !== formData.confirmSenha) return "As senhas não conferem.";

      return null;
  };

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    const error = validateStep2();
    if (error) return addToast(error, "error");
    
    setIsLoading(true);
    setTimeout(() => {
        setIsLoading(false);
        setStep(3); 
        addToast("Dados válidos! Configure o perfil.", "success");
    }, 1000);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsLoading(true);
      
      try {
          await createPartnerLead({
              nome: formData.nome,
              cnpj: formData.cnpj,
              responsavel: formData.responsavel,
              cpf: formData.cpf,
              categoria: formData.categoria,
              email: formData.email,
              telefone: formData.telefone,
              senha: formData.senha,
              descricao: formData.descricao,
              endereco: formData.endereco,
              horario: formData.horario,
              tier: selectedPlan,
              tenantId: tenantId || undefined,
          });

          addToast("Cadastro enviado para aprovação!", "success");
          setTimeout(
            () => router.push(tenantSlug ? withTenantSlug(tenantSlug, "/empresa") : "/empresa"),
            1500
          );
          
      } catch (err: unknown) {
          console.error(err); // 🦈 Log do erro
          addToast("Erro ao salvar cadastro.", "error");
      } finally {
          setIsLoading(false);
      }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 relative overflow-hidden font-sans">
        
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-emerald-600/15 blur-[120px] rounded-full pointer-events-none animate-pulse-slow"></div>
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none"></div>

        {/* ID 79: Botão Voltar Inteligente */}
        <button onClick={handleBack} className="absolute top-6 left-6 text-zinc-500 hover:text-white flex items-center gap-2 transition z-50 font-bold uppercase text-xs tracking-wider">
            <ArrowLeft size={18}/> Voltar
        </button>

        <div className="w-full max-w-lg bg-zinc-900/60 backdrop-blur-xl border border-zinc-800/80 p-8 rounded-[2rem] shadow-2xl relative z-10 my-10">
            
            <div className="text-center mb-8">
                <div className="relative w-24 h-24 mx-auto mb-4 group animate-float-slow">
                    <div className="absolute inset-0 bg-emerald-500/30 blur-xl rounded-full group-hover:bg-emerald-500/50 transition duration-500"></div>
                    <Image 
                        src={tenantLogoUrl || "/logo.png"} 
                        alt={tenantName ? `Logo ${tenantName}` : "Logo da atlética"} 
                        fill
                        sizes="96px"
                        className="object-contain relative z-10 drop-shadow-2xl transition transform group-hover:scale-105" 
                        unoptimized={Boolean(tenantLogoUrl && tenantLogoUrl.startsWith("http"))}
                        priority
                    />
                </div>
                <h1 className="text-2xl font-black text-white uppercase tracking-tighter">Parceria oficial</h1>
                
                <div className="flex items-center justify-center gap-2 mt-4 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                    <span className={step >= 1 ? "text-emerald-500" : ""}>1. Planos</span>
                    <ChevronRight size={10}/>
                    <span className={step >= 2 ? "text-emerald-500" : ""}>2. Dados</span>
                    <ChevronRight size={10}/>
                    <span className={step >= 3 ? "text-emerald-500" : ""}>3. Perfil</span>
                </div>
                <div className="w-full h-1 bg-zinc-800 mt-4 rounded-full overflow-hidden">
                    <div className={`h-full bg-emerald-500 transition-all duration-500 ease-out`} style={{ width: step === 1 ? '33%' : step === 2 ? '66%' : '100%' }}></div>
                </div>
            </div>

            {/* PASSO 1: ESCOLHA DE PLANO */}
            {step === 1 && (
                <div className="space-y-4 animate-in slide-in-from-right duration-300">
                    <h3 className="text-white font-bold text-center mb-4 text-sm uppercase">Escolha seu Plano</h3>
                    <div className="space-y-3">
                        {PLANOS.map((plano) => (
                            <div key={plano.id} onClick={() => handleSelectPlan(plano.id)} className={`p-4 rounded-2xl border cursor-pointer transition hover:scale-[1.02] flex justify-between items-center ${plano.bg} ${plano.border}`}>
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full bg-black/20 ${plano.color}`}><plano.icon size={20}/></div>
                                    <div>
                                        <h4 className={`font-black text-sm uppercase ${plano.color}`}>{plano.nome}</h4>
                                        <span className="text-[10px] text-zinc-400">Benefícios exclusivos</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="block font-black text-white">{plano.valor}</span>
                                    <span className="text-[9px] text-zinc-500 uppercase bg-black/40 px-2 py-1 rounded">Selecionar</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* PASSO 2: DADOS CADASTRAIS */}
            {step === 2 && (
                <form onSubmit={handleNextStep} className="space-y-4 animate-in slide-in-from-right duration-300">
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative">
                            <Store className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                            <input type="text" placeholder="Nome Fantasia" className="input-field pl-14" value={formData.nome} onChange={e => setFormData({...formData, nome: e.target.value})} />
                        </div>
                        <div className="relative">
                            <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                            <input type="text" inputMode="numeric" placeholder="CNPJ (14 dígitos)" maxLength={18} className="input-field pl-14" value={formData.cnpj} onChange={(e) => handleMaskedInputChange("cnpj", e)} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative">
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                            <input type="text" placeholder="Nome Responsável" className="input-field pl-14" value={formData.responsavel} onChange={e => setFormData({...formData, responsavel: e.target.value})} />
                        </div>
                        <div className="relative">
                            <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                            <input type="text" inputMode="numeric" placeholder="CPF Responsável" maxLength={14} className="input-field pl-14" value={formData.cpf} onChange={(e) => handleMaskedInputChange("cpf", e)} />
                        </div>
                    </div>
                    
                    <div className="relative">
                        <Tag className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                        <select className="input-field pl-14 appearance-none text-zinc-400" value={formData.categoria} onChange={e => setFormData({...formData, categoria: e.target.value})}>
                            <option>Alimentação</option><option>Saúde</option><option>Lazer</option><option>Serviços</option><option>Vestuário</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                            <input type="email" placeholder="Email Comercial" className="input-field pl-14" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                        </div>
                        <div className="relative">
                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                            <input type="tel" inputMode="numeric" placeholder="WhatsApp (55 + DDD + número)" maxLength={18} className="input-field pl-14" value={formData.telefone} onChange={(e) => handleMaskedInputChange("telefone", e)} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                            <input type="password" placeholder="Senha (Min 8)" className="input-field pl-14" value={formData.senha} onChange={e => setFormData({...formData, senha: e.target.value})} />
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                            <input type="password" placeholder="Confirmar" className="input-field pl-14" value={formData.confirmSenha} onChange={e => setFormData({...formData, confirmSenha: e.target.value})} />
                        </div>
                    </div>

                    <button type="submit" disabled={isLoading} className="w-full bg-emerald-600 text-white font-black uppercase py-4 rounded-xl shadow-lg hover:bg-emerald-500 transition active:scale-95 flex justify-center items-center gap-2 mt-6">
                        {isLoading ? <Loader2 className="animate-spin" /> : <>Próximo Passo <ChevronRight size={18}/></>}
                    </button>
                </form>
            )}

            {/* PASSO 3: PERFIL VISUAL */}
            {step === 3 && (
                <form onSubmit={handleFinalSubmit} className="space-y-4 animate-in slide-in-from-right duration-300">
                    <div className="bg-zinc-800/50 p-4 rounded-xl border border-zinc-700/50 mb-4 text-center">
                        <p className="text-xs text-zinc-400">Descreva sua empresa para aprovação.</p>
                        <span className="text-[10px] text-emerald-500 font-bold uppercase mt-1 block">Plano Selecionado: {PLANOS.find(p => p.id === selectedPlan)?.nome}</span>
                    </div>

                    <textarea placeholder="Descreva sua empresa e benefícios..." rows={3} className="input-field px-4 pt-3" value={formData.descricao} onChange={e => setFormData({...formData, descricao: e.target.value})}/>
                    <input type="text" placeholder="Endereço Completo" className="input-field px-4" value={formData.endereco} onChange={e => setFormData({...formData, endereco: e.target.value})}/>
                    <input type="text" placeholder="Horário de Funcionamento" className="input-field px-4" value={formData.horario} onChange={e => setFormData({...formData, horario: e.target.value})}/>
                    
                    <div className="text-center text-xs text-zinc-500 mt-2">
                        * Logos e Capas poderão ser adicionados após a aprovação no painel.
                    </div>

                    <button type="submit" disabled={isLoading} className="w-full bg-emerald-600 text-white font-black uppercase py-4 rounded-xl shadow-lg hover:bg-emerald-500 transition active:scale-95 flex justify-center items-center gap-2 mt-6">
                        {isLoading ? <Loader2 className="animate-spin" /> : <>Finalizar Cadastro <CheckCircle size={18}/></>}
                    </button>
                </form>
            )}
        </div>

        <style jsx>{`
            .input-field { width: 100%; background-color: rgba(0,0,0,0.4); border: 1px solid #27272a; border-radius: 0.75rem; padding: 1rem; padding-left: 3.5rem; color: white; outline: none; transition: all 0.3s; font-size: 0.875rem; }
            .input-field:focus { border-color: #10b981; background-color: rgba(0,0,0,0.8); }
            .animate-float-slow { animation: float 6s ease-in-out infinite; }
            @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        `}</style>
    </div>
  );
}
