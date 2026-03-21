"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowLeft, CreditCard, ChevronRight,
  QrCode, X, Award, Ghost
} from "lucide-react";
import Link from "next/link";
import Image from "next/image"; // ðŸ¦ˆ Importado para otimização
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  CARTEIRINHA_CONFIG_SYNC_KEY,
  CARTEIRINHA_CONFIG_UPDATED_EVENT_NAME,
  fetchCarteirinhaConfig,
  resolveCarteirinhaConfigSyncKey,
  type CarteirinhaConfig,
} from "@/lib/carteirinhaService";
import { QRCodeSVG } from "qrcode.react";
import SharkLoader from "@/app/components/SharkLoader";
import { getTurmaImage } from "@/constants/turmaImages";
import { resolvePlanTheme, resolveUserPlanIcon } from "@/constants/planVisuals";
import { withTenantSlug } from "@/lib/tenantRouting";

export default function CarteirinhaPage() {
  const { user, loading } = useAuth();
  const { palette, tenantId, tenantLogoUrl, tenantSigla, tenantCourse, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const [config, setConfig] = useState<CarteirinhaConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [showQrModal, setShowQrModal] = useState(false);

  // 1. Buscar Configuração Visual do Admin
  useEffect(() => {
      let mounted = true;

      const loadConfig = async (forceRefresh = false) => {
          try {
              const loadedConfig = await fetchCarteirinhaConfig(
                forceRefresh
                  ? { forceRefresh: true, tenantId: tenantId || undefined }
                  : { tenantId: tenantId || undefined }
              );
              if (mounted) setConfig(loadedConfig);
          } catch (error: unknown) {
              console.error("Erro config carteirinha", error);
              if (mounted) addToast("Erro ao carregar dados da carteirinha.", "error");
          } finally {
              if (mounted) setLoadingConfig(false);
          }
      };

      const handleRefresh = () => {
        void loadConfig(true);
      };

      const handleStorage = (event: StorageEvent) => {
        const expectedKey = resolveCarteirinhaConfigSyncKey(tenantId || undefined);
        if (event.key !== expectedKey && event.key !== CARTEIRINHA_CONFIG_SYNC_KEY) return;
        handleRefresh();
      };

      void loadConfig();
      window.addEventListener(CARTEIRINHA_CONFIG_UPDATED_EVENT_NAME, handleRefresh);
      window.addEventListener("storage", handleStorage);

      return () => {
          mounted = false;
          window.removeEventListener(CARTEIRINHA_CONFIG_UPDATED_EVENT_NAME, handleRefresh);
          window.removeEventListener("storage", handleStorage);
      };
  }, [addToast, tenantId]);

  const dashboardHref = tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard";
  const planosHref = tenantSlug ? withTenantSlug(tenantSlug, "/planos") : "/planos";

  if (loading) return <SharkLoader />;
  if (!user) return null;

  // --- LÃ“GICA DE FUNDO (BACKGROUND) ---
  const bgPadrao = getTurmaImage(user.turma);
  const bgFinal = config?.backgrounds?.[user.turma || ""] || bgPadrao;
  const validadeTexto = config?.validade || "DEZ/2026";
  const backgroundIntensity = Math.max(
    0,
    Math.min(100, config?.backgroundOpacity ?? 60)
  ) / 100;
  const imageOpacity = 0.16 + backgroundIntensity * 0.58;
  const imageBrightness = 0.42 + backgroundIntensity * 0.46;
  const imageSaturation = 0.65 + backgroundIntensity * 0.7;
  const overlayOpacity = 0.58 - backgroundIntensity * 0.28;

  // --- ðŸ¦ˆ LÃ“GICA VISUAL DINÃ‚MICA ---
  const userCor = user.plano_cor || "zinc"; 
  const userIconName = user.plano_icon || "ghost";

  // Define o estilo
  const style = resolvePlanTheme(userCor);
  const PlanIcon = resolveUserPlanIcon(userIconName, user.plano, Ghost);
  const canUpgrade = userCor === 'zinc' || userCor === 'emerald';

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans flex flex-col selection:bg-emerald-500/30 pb-24">
      
      {/* HEADER */}
      <header className="px-6 py-5 flex items-center justify-between sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-white/5">
        <Link
          href={dashboardHref}
          className="p-2 -ml-2 text-zinc-400 hover:text-white transition rounded-full hover:bg-white/5"
        >
          <ArrowLeft size={24} />
        </Link>
        <h1 className="font-bold text-sm uppercase tracking-[0.2em] flex items-center gap-2 text-emerald-500">
          <CreditCard size={16} /> Identidade
        </h1>
        <div className="w-8"></div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start pt-8 px-6 relative overflow-hidden space-y-8 w-full max-w-md mx-auto">
        
        {/* Luz de fundo ambiente */}
        <div className={`absolute top-20 left-1/2 -translate-x-1/2 w-[300px] h-[300px] blur-[100px] rounded-full pointer-events-none opacity-20 ${style.bgClass}`}></div>

        {/* --- CARTÒO DIGITAL --- */}
        <div className={`relative w-full aspect-[1.586/1] rounded-2xl overflow-hidden shadow-2xl transition-all duration-500 border border-white/10 ${style.glowClass}`}>
          
          {/* === CAMADA DE FUNDO === */}
          <div className="absolute inset-0 z-0 bg-zinc-900">
             <div className="absolute inset-0 bg-zinc-900" />
              <Image
                 src={bgFinal}
                 alt="Background Turma"
                 fill
                 className="object-cover scale-105 transition-all duration-500"
                 style={{
                   opacity: imageOpacity,
                   filter: `brightness(${imageBrightness}) saturate(${imageSaturation}) contrast(${0.92 + backgroundIntensity * 0.18})`,
                 }}
                  // Permite URLs externas/base64 sem config no next.config.js
                 priority
              />
             <div
               className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-black/75 transition-opacity duration-500"
               style={{ opacity: overlayOpacity }}
             ></div>
             <div className="absolute inset-0 opacity-[0.07] bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]"></div>
          </div>

          {/* === CONTEÃšDO DO CARTÒO === */}
          <div className="relative z-10 w-full h-full p-5 flex flex-col justify-between">
            
            {/* 1. TOPO: Logo e Status */}
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-black/80 backdrop-blur rounded-lg flex items-center justify-center border border-white/10 shadow-lg relative overflow-hidden">
                  <Image
                    src={tenantLogoUrl || "/logo.png"}
                    alt="Logo"
                    width={32}
                    height={32}
                    priority
                    className="object-contain"
                    style={{ width: "auto", height: "auto" }}
                  />
                </div>
                <div>
                  <h2 className="font-black text-white text-lg leading-none tracking-tight">
                    {(tenantSigla || "USC").toUpperCase()}
                  </h2>
                  <p
                    className="text-[9px] uppercase tracking-widest font-bold"
                    style={{ color: palette.primary }}
                  >
                    {(tenantCourse || "Atletica").toUpperCase()}
                  </p>
                </div>
              </div>

              {/* Badge do Plano */}
              <div className={`px-2.5 py-1 rounded-md border backdrop-blur-md flex items-center gap-1.5 shadow-lg ${style.textClass} ${style.borderClass} ${style.softBgClass}`}>
                  <PlanIcon size={10} className="stroke-[3]" />
                  <span className="text-[9px] font-black uppercase tracking-wider">{user.plano || "Visitante"}</span>
              </div>
            </div>

            {/* 2. MEIO: Foto e Dados */}
            <div className="flex items-center gap-4 mt-2">
              <div className={`w-[72px] h-[96px] flex-shrink-0 rounded-lg border-2 p-[2px] bg-black/50 shadow-xl overflow-hidden relative ${style.borderClass}`}>
                <div className="relative w-full h-full overflow-hidden rounded-[4px]">
                    <Image
                      src={user.foto || "https://github.com/shadcn.png"}
                      alt="Foto do Atleta"
                      fill
                      className="object-cover object-top"
                      
                    />
                </div>
                <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-white/0 pointer-events-none rounded-[4px]"></div>
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                 <div>
                    <p className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider leading-none mb-1">Nome do Atleta</p>
                    <h3 className="text-white font-black text-base uppercase leading-tight truncate">{user.nome}</h3>
                 </div>
                 
                 <div className="flex items-center gap-4 mt-2">
                    <div>
                        <p className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider leading-none mb-0.5">Turma</p>
                        <p className="text-sm font-bold text-white">{user.turma || "CALOURO"}</p>
                    </div>
                    <div>
                        <p className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider leading-none mb-0.5">Matrícula</p>
                        <p className="text-sm font-mono text-zinc-300 tracking-tight">{user.matricula || "---"}</p>
                    </div>
                 </div>
              </div>
            </div>

            {/* 3. RODAPÃ‰ */}
            <div className="flex justify-between items-end border-t border-white/10 pt-2.5 mt-1">
                <div>
                    <p className="text-[8px] text-zinc-500 uppercase font-bold tracking-widest mb-0.5">Validade</p>
                    {loadingConfig ? (
                        <div className="h-3 w-12 bg-white/10 animate-pulse rounded"></div>
                    ) : (
                        <p className="text-[10px] text-emerald-400 font-mono font-bold tracking-wider">{validadeTexto}</p>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-[8px] text-right text-zinc-500 font-medium uppercase hidden sm:block">
                        Escaneie para<br/>validar acesso
                    </span>
                    <div className="bg-white p-1 rounded shadow-lg">
                        <QRCodeSVG value={user.uid} size={36} />
                    </div>
                </div>
            </div>

          </div>
        </div>

        {/* --- AÃ‡Ã•ES INFERIORES --- */}
        <div className="w-full space-y-3">
          
          {canUpgrade && (
              <Link
                href={planosHref}
                className="group relative w-full block overflow-hidden rounded-xl bg-gradient-to-r from-emerald-900/50 to-black border border-emerald-500/30 p-4 transition-all active:scale-[0.98]"
              >
                <div className="absolute inset-0 bg-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                      <Award size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Nível Atual: {user.plano || "Bicho"}</p>
                      <p className="text-sm font-bold text-white">Fazer Upgrade</p>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-zinc-500 group-hover:text-white transition-colors" />
                </div>
              </Link>
          )}

          <button 
            onClick={() => setShowQrModal(true)}
            className="w-full bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 text-zinc-300 hover:text-white transition py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 shadow-sm"
          >
            <QrCode size={18} /> Ampliar QR Code
          </button>

          <p className="text-zinc-600 text-[10px] text-center uppercase font-medium tracking-widest mt-4">
             Documento Digital Oficial ⬢ {(tenantSigla || "USC").toUpperCase()}
          </p>
        </div>
      </main>

      {/* --- MODAL QR CODE --- */}
      {showQrModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm p-6 animate-in fade-in zoom-in duration-200" onClick={() => setShowQrModal(false)}>
              <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 text-center relative shadow-[0_0_100px_rgba(16,185,129,0.2)] flex flex-col items-center" onClick={e => e.stopPropagation()}>
                  
                  <button onClick={() => setShowQrModal(false)} className="absolute top-4 right-4 text-zinc-400 hover:text-black bg-zinc-100 hover:bg-zinc-200 p-2 rounded-full transition">
                    <X size={20}/>
                  </button>
                  
                  <div className="mb-6 mt-2">
                      <div className="w-12 h-12 bg-black rounded-xl mx-auto flex items-center justify-center mb-3 relative overflow-hidden">
                        <Image
                          src={tenantLogoUrl || "/logo.png"}
                          alt="Logo"
                          width={28}
                          height={28}
                          priority
                          className="object-contain"
                          style={{ width: "auto", height: "auto" }}
                        />
                      </div>
                      <h3 className="text-black font-black text-xl uppercase tracking-tighter">Acesso Atleta</h3>
                      <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mt-1">Aproxime do Leitor</p>
                  </div>

                  <div className="p-4 border-[6px] border-black rounded-3xl mb-6 shadow-xl">
                      <QRCodeSVG value={user.uid} size={220} />
                  </div>

                  <div className="w-full bg-zinc-50 border border-zinc-200 py-3 rounded-xl">
                      <p className="text-[9px] text-zinc-400 uppercase font-bold tracking-widest mb-1">ID Segurança</p>
                      <p className="text-xs text-black font-mono font-bold truncate px-4">{user.uid.slice(0, 12)}...</p>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}



