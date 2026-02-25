"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { 
  Sparkles, Users, MapPin, Mail, Phone, Instagram, 
  Dumbbell, Star, Rocket, Crown, Eye 
} from "lucide-react";

// Ã°Å¸Â¦Ë† IMPORTS DO SISTEMA
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { fetchPublicLandingData } from "../lib/publicLandingService";
import { type LandingConfig } from "../lib/adminLandingService";

const DEFAULT_CONFIG: LandingConfig = {
  heroTitle: "SEJA UM",
  heroSubtitle: "Centralize sua vida universitaria. Carteirinha, Loja e Eventos.",
  heroHighlight: "TUBARAO REI",
  tagline: "GESTAO ESPORTIVA 2.0",
  taglineColor: "#10b981",
  titleColor: "#ffffff",
  gradientStart: "#34d399",
  gradientEnd: "#10b981",
  statUsers: 120,
  statPosts: 340,
  statPartners: 12,
  address: "Campus Medicina - Bloco C",
  phone: "(12) 99999-9999",
  whatsapp: "5512999999999",
  email: "suporte@aaakn.com.br",
  socialLinks: [],
  reviews: []
};

// --- HOOK: Contadores Animados ---
const useCounter = (end: number, duration: number = 2000) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let start = 0;
    if (end === 0) return;
    const increment = end / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) { setCount(end); clearInterval(timer); } 
      else { setCount(Math.ceil(start)); }
    }, 16);
    return () => clearInterval(timer);
  }, [end, duration]);
  return count;
};

// --- COMPONENTE: Card de EstatÃƒÂ­stica ---
type StatColor = "emerald" | "blue" | "amber";

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  color: StatColor;
  suffix?: string;
}

const StatCard = ({ icon: Icon, value, label, color, suffix = "" }: StatCardProps) => {
  const count = useCounter(value);
  const colors: Record<StatColor, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20"
  };
  return (
    <div className={`flex flex-col items-center p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 backdrop-blur-md transition-all hover:scale-105 ${colors[color] ? "" : "border-zinc-800"}`}>
      <div className={`p-3 rounded-full mb-3 ${colors[color] || "bg-zinc-800"}`}><Icon className="w-6 h-6" /></div>
      <span className="text-3xl font-black text-white tracking-tight">{count}{suffix}</span>
      <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold mt-1 text-center">{label}</span>
    </div>
  );
};

export default function LandingPage() {
  const router = useRouter();
  const { user, loginGoogle, loading: authLoading } = useAuth();
  const { addToast } = useToast();

  const [config, setConfig] = useState<LandingConfig>(DEFAULT_CONFIG);
  const [realStats, setRealStats] = useState({ users: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"aluno" | "empresa">("aluno");

  // Ã°Å¸â€â€™ Redirecionamento de SeguranÃƒÂ§a
  useEffect(() => {
    if (!authLoading && user) router.push("/dashboard");
  }, [user, authLoading, router]);

  // Ã°Å¸â€œÂ¡ Busca ConfiguraÃƒÂ§ÃƒÂµes Visuais
  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await fetchPublicLandingData({
          fallbackConfig: DEFAULT_CONFIG,
        });
        setConfig(data.config);
        setRealStats({ users: data.usersCount || DEFAULT_CONFIG.statUsers });
      } catch (error: unknown) {
        console.error("Erro ao carregar landing:", error);
      } finally {
        setLoading(false);
      }
    };
    void fetchData();
  }, []);

  const handleGoogleLogin = async () => { try { await loginGoogle(); } catch { addToast("Erro no login Google", "error"); } };
  const handleGuest = () => { addToast("Modo Visitante Ativado!", "info"); router.push("/dashboard"); };

  if (loading) return <div className="h-screen bg-[#030a08] flex items-center justify-center text-emerald-500 font-bold animate-pulse">CARREGANDO CARDUME...</div>;

  return (
    <div className="min-h-screen bg-[#030a08] text-white selection:bg-emerald-500/30 overflow-x-hidden font-sans">
      
      {/* Ã°Å¸Å’Å  Background Layers */}
      <div className="fixed inset-0 pointer-events-none z-0">
         <div className="absolute top-[-10%] left-[-20%] w-[80%] h-[80%] bg-emerald-500/5 rounded-full blur-[120px] animate-pulse-slow" />
         <div className="absolute bottom-[-10%] right-[-20%] w-[80%] h-[80%] bg-teal-600/5 rounded-full blur-[120px] animate-pulse-slow delay-700" />
      </div>

      {/* ================= HERO SECTION ================= */}
      <main className="relative z-10 container mx-auto px-4 pt-10 pb-20 lg:pt-20 lg:flex lg:items-center lg:gap-16">
        
        {/* ESQUERDA: Texto DinÃƒÂ¢mico */}
        <div className="flex-1 text-center lg:text-left space-y-8">
            <div className="relative w-48 h-48 lg:w-64 lg:h-64 mx-auto lg:mx-0 animate-float-slow group">
                <div className="absolute inset-0 bg-emerald-500/20 blur-[50px] rounded-full scale-75" />
                <Image 
                    src="/logo.png" 
                    alt="Logo AAAKN" 
                    width={256} height={256} 
                    className="relative z-10 object-contain drop-shadow-[0_0_35px_rgba(16,185,129,0.4)]"
                    priority
                />
            </div>

            <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest animate-pulse mx-auto lg:mx-0" style={{ color: config.taglineColor }}>
                    <Sparkles size={12} /> {config.tagline}
                </div>
                
                <h1 className="text-5xl lg:text-7xl font-black tracking-tighter leading-[0.9]" style={{ color: config.titleColor }}>
                    {config.heroTitle} <br className="hidden lg:block"/>
                    <span 
                      className="text-transparent bg-clip-text animate-text-shimmer bg-[length:200%_auto]"
                      style={{ backgroundImage: `linear-gradient(to right, ${config.gradientStart}, ${config.gradientEnd}, ${config.gradientStart})` }}
                    >
                        {config.heroHighlight}
                    </span>
                </h1>
                
                <p className="text-zinc-400 text-base lg:text-lg max-w-xl mx-auto lg:mx-0 leading-relaxed font-medium">
                    {config.heroSubtitle}
                </p>
            </div>

            {/* Stats Bar - Ã°Å¸Â¦Ë† RANKING REMOVIDO DAQUI */}
            <div className="grid grid-cols-3 gap-4 w-full max-w-lg mx-auto lg:mx-0">
                <StatCard icon={Users} value={realStats.users || config.statUsers} label="Socios" color="emerald" />
                <StatCard icon={Dumbbell} value={config.statPosts} label="Treinos" color="blue" />
                <StatCard icon={Rocket} value={config.statPartners} label="Parceiros" color="amber" />
            </div>
        </div>

        {/* DIREITA: Login Card */}
        <div className="flex-1 max-w-md w-full mx-auto mt-12 lg:mt-0">
            <div className="bg-zinc-900/40 backdrop-blur-xl rounded-[2rem] border border-zinc-800 p-8 shadow-2xl relative">
                <div className="flex p-1.5 bg-zinc-950/60 rounded-xl mb-6 border border-zinc-800/50">
                    <button onClick={() => setActiveTab("aluno")} className={`flex-1 py-3 text-[10px] font-extrabold uppercase tracking-wider rounded-lg transition-all ${activeTab === "aluno" ? "bg-zinc-800 text-white shadow-md" : "text-zinc-500"}`}>Sou Aluno</button>
                    <button onClick={() => setActiveTab("empresa")} className={`flex-1 py-3 text-[10px] font-extrabold uppercase tracking-wider rounded-lg transition-all ${activeTab === "empresa" ? "bg-zinc-800 text-white shadow-md" : "text-zinc-500"}`}>Parceiro</button>
                </div>

                {activeTab === "aluno" ? (
                   <div className="space-y-6">
                       <button onClick={handleGoogleLogin} className="w-full bg-white hover:bg-zinc-200 text-zinc-900 font-black py-4 rounded-xl flex items-center justify-center gap-3 transition-all">
                           <Image src="https://www.google.com/favicon.ico" alt="G" width={20} height={20} />
                           {authLoading ? "Conectando..." : "Entrar com Google"}
                       </button>
                       <button onClick={handleGuest} className="w-full py-3.5 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2">
                           <Eye size={16} /> Entrar como Visitante
                       </button>
                   </div>
                ) : (
                   <div className="text-center py-8 text-zinc-500 text-xs">Area restrita a parceiros.</div>
                )}
            </div>
        </div>
      </main>

      {/* ================= PLANOS REMOVIDOS ================= */}
      {/* A seÃƒÂ§ÃƒÂ£o de planos foi totalmente removida conforme solicitado pelo TubarÃƒÂ£o */}

      {/* ================= DEPOIMENTOS ================= */}
      <section className="py-20 container mx-auto px-4 border-t border-white/5 bg-zinc-950/30">
        <div className="flex items-center gap-2 mb-8 justify-center lg:justify-start">
            <Star className="text-emerald-500 fill-emerald-500" />
            <h3 className="text-xl font-black text-white uppercase tracking-tight">O Cardume Aprova</h3>
        </div>
        
        <div className="flex gap-6 overflow-x-auto pb-8 px-4 scrollbar-hide snap-x md:grid md:grid-cols-3 md:overflow-visible">
            {(config.reviews || []).length > 0 ? config.reviews.map((review) => (
                <div key={review.id} className="flex flex-col gap-4 p-6 bg-zinc-900/80 border border-zinc-800 rounded-2xl min-w-[300px] hover:border-emerald-500/30 transition-all shadow-lg snap-center">
                    <div className="flex items-center gap-3">
                        <div className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-emerald-500/30 bg-zinc-800">
                            <Image 
                                src={review.profileUrl || "/logo.png"} 
                                alt={review.name} 
                                fill 
                                className={`object-cover ${!review.profileUrl ? "grayscale opacity-50 p-1" : ""}`} 
                            />
                        </div>
                        <div>
                            <h4 className="text-white font-bold text-sm leading-tight">{review.name}</h4>
                            <span className="text-zinc-500 text-[10px] uppercase font-bold">{review.role}</span>
                        </div>
                    </div>
                    <div className="flex gap-1">
                        {[1,2,3,4,5].map(i => <Star key={i} size={12} className="fill-amber-400 text-amber-400" />)}
                    </div>
                    <p className="text-zinc-300 text-xs italic leading-relaxed line-clamp-4">&quot;{review.text}&quot;</p>
                </div>
            )) : (
                <p className="text-zinc-500 text-xs italic col-span-3 text-center">Nenhum depoimento cadastrado ainda.</p>
            )}
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="bg-zinc-950 pt-16 pb-8 border-t border-zinc-900">
        <div className="container mx-auto px-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
                <div className="space-y-4">
                    <div className="flex items-center gap-2"><Crown className="text-emerald-500 w-5 h-5" /><span className="font-black text-xl text-white">AAAKN</span></div>
                    <p className="text-zinc-500 text-xs leading-relaxed">Plataforma oficial da Atletica.</p>
                </div>

                <div>
                    <h4 className="text-white font-bold mb-4 uppercase text-xs tracking-wider">Suporte</h4>
                    <ul className="space-y-3 text-xs text-zinc-500">
                        <li className="flex items-center gap-2"><MapPin size={14} className="text-emerald-600"/> {config.address}</li>
                        <li className="flex items-center gap-2"><Mail size={14} className="text-emerald-600"/> {config.email}</li>
                        <li className="flex items-center gap-2"><Phone size={14} className="text-emerald-600"/> {config.phone}</li>
                        
                        {(config.socialLinks || []).map(social => (
                            <li key={social.id} className="pt-2">
                                <a href={social.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-bold capitalize">
                                    <Instagram size={14}/> {social.platform}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            <div className="pt-8 border-t border-zinc-900 text-center text-[10px] text-zinc-600">
                <p>&copy; {new Date().getFullYear()} AAAKN. Todos os direitos reservados.</p>
                <p className="mt-1">O Tubarao ja subiu para a base.</p>
            </div>
        </div>
      </footer>
    </div>
  );
}

