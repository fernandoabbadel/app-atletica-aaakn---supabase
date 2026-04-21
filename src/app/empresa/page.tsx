"use client";

import React, { useState } from "react";
import { Loader2, Mail, Lock } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "../../context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { loginPartnerByEmail } from "../../lib/partnersPublicService";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";

export default function EmpresaLoginPage() {
  const router = useRouter();
  const pathname = usePathname() || "/empresa";
  const { addToast } = useToast();
  const { tenantId, tenantLogoUrl, tenantName } = useTenantTheme();
  const pathInfo = parseTenantScopedPath(pathname);
  const companyBasePath = pathInfo.tenantSlug
    ? withTenantSlug(pathInfo.tenantSlug, "/empresa")
    : "/empresa";
  const companyRegisterPath = pathInfo.tenantSlug
    ? withTenantSlug(pathInfo.tenantSlug, "/empresa/cadastro")
    : "/empresa/cadastro";
  
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const loginResult = await loginPartnerByEmail({
        email,
        senha,
        tenantId: tenantId || undefined,
      });
      if (!loginResult) {
        addToast("E-mail não encontrado.", "error");
        setLoading(false);
        return;
      }

      if (!loginResult.passwordValid) {
          addToast("Senha incorreta.", "error");
          setLoading(false);
          return;
      }

      if (loginResult.status === 'pending') {
          addToast("Cadastro em análise. Aguarde aprovação.", "info");
          setLoading(false);
          return;
      }

      if (loginResult.status === 'disabled') {
          addToast("Acesso desativado. Contate a Atlética.", "error");
          setLoading(false);
          return;
      }

      addToast(`Bem-vindo, ${loginResult.nome}!`, "success");
      router.push(`${companyBasePath}/${loginResult.id}`);

    } catch (error: unknown) {
      console.error("Erro no login:", error);
      addToast("Erro de conexão.", "error");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 relative overflow-hidden font-sans">
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-emerald-600/15 blur-[120px] rounded-full pointer-events-none animate-pulse-slow"></div>
        
        <div className="w-full max-w-md bg-zinc-900/60 backdrop-blur-xl border border-zinc-800/80 p-8 rounded-[2rem] shadow-2xl relative z-10">
            <div className="text-center mb-8">
                <div className="relative w-24 h-24 mx-auto mb-4 group">
                   <div className="absolute inset-0 bg-emerald-500/30 blur-xl rounded-full group-hover:bg-emerald-500/50 transition duration-500"></div>
                   <Image 
                     src={tenantLogoUrl || "/logo.png"} 
                     alt={tenantName ? `Logo ${tenantName}` : "Logo da atlética"} 
                     fill
                     sizes="96px"
                     className="object-contain relative z-10 drop-shadow-2xl" 
                     unoptimized={Boolean(tenantLogoUrl && tenantLogoUrl.startsWith("http"))}
                     priority
                   />
                </div>
                <h1 className="text-2xl font-black text-white uppercase tracking-tighter mb-1">Área do Parceiro</h1>
                <p className="text-zinc-400 text-xs font-medium">Gerencie seus cupons e métricas.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
                <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18}/>
                    <input 
                      type="email" 
                      placeholder="Email Corporativo" 
                      className="w-full bg-black/50 border border-zinc-700 rounded-xl p-4 pl-12 text-white outline-none focus:border-emerald-500 transition"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                    />
                </div>
                <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18}/>
                    <input 
                      type="password" 
                      placeholder="Senha" 
                      className="w-full bg-black/50 border border-zinc-700 rounded-xl p-4 pl-12 text-white outline-none focus:border-emerald-500 transition"
                      value={senha}
                      onChange={e => setSenha(e.target.value)}
                      required
                    />
                </div>
                <button type="submit" disabled={loading} className="w-full bg-emerald-600 text-white font-black uppercase py-4 rounded-xl shadow-lg hover:bg-emerald-500 transition active:scale-95 flex justify-center gap-2">
                    {loading ? <Loader2 className="animate-spin"/> : "Acessar Painel"}
                </button>
            </form>

            <div className="text-center mt-6 pt-6 border-t border-zinc-800">
                <Link href={companyRegisterPath} className="text-emerald-400 font-bold text-sm hover:underline uppercase tracking-wide">Quero me Cadastrar</Link>
            </div>
        </div>
    </div>
  );
}
