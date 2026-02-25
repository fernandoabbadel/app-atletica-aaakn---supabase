"use client";

import React, { useState, useEffect } from "react";

interface SharkAvatarProps {
  name?: string;
  level?: number;
  size?: "sm" | "md" | "lg" | "xl";
  customColor?: string;    
  customEyeColor?: string; 
  className?: string;
}

export default function SharkAvatar({ 
    name, 
    level = 1, 
    size = "md", 
    customColor = "#64748b", 
    customEyeColor = "#0f172a", 
    className = ""
}: SharkAvatarProps) {
  
  const [blink, setBlink] = useState(false);
  const [isHappy, setIsHappy] = useState(false);
  const isEvolved = level >= 20;

  const sizeMap = {
    sm: "w-20 h-20",
    md: "w-32 h-32",
    lg: "w-48 h-48",
    xl: "w-64 h-64"
  };

  useEffect(() => {
    let isMounted = true;
    let openEyeTimer: ReturnType<typeof setTimeout> | null = null;
    let nextBlinkTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleBlink = () => {
      nextBlinkTimer = setTimeout(() => {
        if (!isMounted) return;
        setBlink(true);

        openEyeTimer = setTimeout(() => {
          if (!isMounted) return;
          setBlink(false);
          scheduleBlink();
        }, 180);
      }, Math.random() * 3000 + 2000);
    };

    scheduleBlink();

    return () => {
      isMounted = false;
      if (openEyeTimer) clearTimeout(openEyeTimer);
      if (nextBlinkTimer) clearTimeout(nextBlinkTimer);
    };
  }, []);

  return (
    <div 
        className={`relative flex flex-col items-center justify-center group select-none cursor-pointer ${className}`}
        onClick={() => { setIsHappy(true); setTimeout(() => setIsHappy(false), 1000); }}
    >
      
      {/* CONTAINER FLUTUANTE */}
      <div className={`${sizeMap[size]} relative ${isEvolved ? 'animate-float-gentle' : 'animate-jelly'} z-10 flex items-center justify-center`}>
        
        <svg 
            viewBox="0 0 200 200" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg" 
            className="w-full h-full drop-shadow-xl overflow-visible"
            style={{ filter: "drop-shadow(0px 12px 10px rgba(0,0,0,0.25))" }}
        >
           <defs>
             <linearGradient id="skinGrad" x1="100" y1="0" x2="100" y2="180" gradientUnits="userSpaceOnUse">
               <stop offset="0%" stopColor={customColor} stopOpacity="0.9" />
               <stop offset="50%" stopColor={customColor} />
               <stop offset="100%" stopColor="#0f172a" stopOpacity="0.6" />
             </linearGradient>

             <radialGradient id="customEye" cx="0.3" cy="0.3" r="0.8">
                 <stop offset="0%" stopColor={customEyeColor} stopOpacity="0.8" />
                 <stop offset="100%" stopColor={customEyeColor} />
             </radialGradient>

             <linearGradient id="bellyGrad" x1="100" y1="80" x2="100" y2="180" gradientUnits="userSpaceOnUse">
               <stop offset="0%" stopColor="#ffffff" />
               <stop offset="100%" stopColor="#e2e8f0" />
             </linearGradient>
           </defs>

           {/* ==================== BABY SLIME (< 20) ==================== */}
           {!isEvolved && (
             <g transform="translate(0, 10)">
               <path d="M140 130 Q 160 120 155 150 L 130 145 Z" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.1)" strokeWidth="1" className="origin-[140px_130px] animate-wag"/>
               <path d="M100 40 Q 120 10 135 60 L 110 70 Z" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.1)" strokeWidth="1"/>
               <path d="M60 60 C 60 20, 140 20, 140 60 C 145 100, 130 130, 100 130 C 70 130, 55 100, 60 60 Z" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.1)" strokeWidth="2"/>
               
               <g transform="translate(0, 10)">
                  <g transform="translate(80, 85)">
                      <ellipse cx="0" cy="0" rx="9" ry={blink ? 1 : 11} fill="url(#customEye)" />
                      {!blink && <circle cx="3" cy="-3" r="3" fill="white" opacity="0.9"/>}
                  </g>
                  <g transform="translate(120, 85)">
                      <ellipse cx="0" cy="0" rx="9" ry={blink ? 1 : 11} fill="url(#customEye)" />
                      {!blink && <circle cx="3" cy="-3" r="3" fill="white" opacity="0.9"/>}
                  </g>
                  {isHappy ? <path d="M92 95 Q 100 105 108 95" fill="#334155" /> : <path d="M95 98 Q 100 102 105 98" stroke="#334155" strokeWidth="2" strokeLinecap="round" fill="none" />}
                  <ellipse cx="70" cy="95" rx="5" ry="3" fill="#fda4af" opacity="0.6"/>
                  <ellipse cx="130" cy="95" rx="5" ry="3" fill="#fda4af" opacity="0.6"/>
               </g>
               <path d="M62 90 Q 45 100 50 80" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.1)" strokeWidth="2" />
               <path d="M138 90 Q 155 100 150 80" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.1)" strokeWidth="2" />
             </g>
           )}

           {/* ==================== EVOLVED SHARK (20+) ==================== */}
           {isEvolved && (
             <g>
               <path d="M100 140 Q 130 130 135 160 L 100 155 L 65 160 Q 70 130 100 140 Z" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.2)" strokeWidth="2" className="origin-[100px_140px] animate-tail-happy"/>
               <path d="M55 100 Q 20 110 30 85 Q 45 80 55 90" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.2)" strokeWidth="2" className="origin-[55px_90px] animate-fin-flap-left"/>
               <path d="M145 100 Q 180 110 170 85 Q 155 80 145 90" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.2)" strokeWidth="2" className="origin-[145px_90px] animate-fin-flap-right"/>
               <path d="M100 15 C 140 15, 155 60, 150 130 C 145 155, 125 165, 100 165 C 75 165, 55 155, 50 130 C 45 60, 60 15, 100 15 Z" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.2)" strokeWidth="2"/>
               <path d="M100 15 Q 115 5 120 40 L 100 50 Z" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.2)" strokeWidth="2" />
               <path d="M100 65 C 125 65, 130 100, 125 140 C 120 155, 110 160, 100 160 C 90 160, 80 155, 75 140 C 70 100, 75 65, 100 65 Z" fill="url(#bellyGrad)" opacity="0.9"/>
               <g transform="translate(0, 5)">
                  <g transform="translate(70, 85)">
                      <ellipse cx="0" cy="0" rx="10" ry={blink ? 1 : 12} fill="url(#customEye)" />
                      {!blink && <circle cx="3" cy="-4" r="3.5" fill="white" opacity="0.9"/>}
                  </g>
                  <g transform="translate(130, 85)">
                      <ellipse cx="0" cy="0" rx="10" ry={blink ? 1 : 12} fill="url(#customEye)" />
                      {!blink && <circle cx="3" cy="-4" r="3.5" fill="white" opacity="0.9"/>}
                  </g>
                  {isHappy ? <path d="M92 95 Q 100 105 108 95 Z" fill="#334155" /> : <path d="M92 98 Q 100 105 108 98" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" fill="none" />}
                  <path d="M45 85 L42 88 M46 92 L43 95" stroke="#334155" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
                  <path d="M155 85 L158 88 M154 92 L157 95" stroke="#334155" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
               </g>
             </g>
           )}
        </svg>
      </div>

      {/* SOMBRA NO CHÃO */}
      <div className="w-24 h-4 bg-black/40 rounded-[100%] blur-md animate-shadow-gentle -mt-6 z-0"></div>

      {/* LABEL DO NOME E NÍVEL (AGORA MAIS PERTO COM -mt-6) */}
      {name && (
        <div className="flex flex-col items-center animate-float-gentle -mt-2 relative z-20" style={{ animationDelay: "0.2s" }}>
            <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest bg-black/80 px-2 py-0.5 rounded-t-md border-t border-x border-zinc-700 -mb-1 relative z-0">LVL {level}</span>
            <div className={`bg-white/10 backdrop-blur-md px-3 py-1 rounded-md border border-white/20 shadow-sm flex items-center gap-1.5 relative z-10 ${isEvolved ? 'border-emerald-500/50' : ''}`}>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300">
                    {name}
                </span>
            </div>
        </div>
      )}

      <style jsx>{`
        @keyframes float-gentle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        .animate-float-gentle { animation: float-gentle 4s infinite ease-in-out; }
        @keyframes jelly { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.05, 0.95); } }
        .animate-jelly { animation: jelly 3s infinite ease-in-out; }
        @keyframes shadow-gentle { 0%, 100% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(0.9); opacity: 0.15; } }
        .animate-shadow-gentle { animation: shadow-gentle 4s infinite ease-in-out; }
        @keyframes tail-happy { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
        .animate-tail-happy { animation: tail-happy 1s infinite ease-in-out alternate; }
        @keyframes wag { 0%, 100% { transform: rotate(-10deg); } 50% { transform: rotate(15deg); } }
        .animate-wag { animation: wag 1s infinite ease-in-out alternate; }
        @keyframes fin-flap-left { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(10deg); } }
        .animate-fin-flap-left { animation: fin-flap-left 2s infinite ease-in-out alternate; }
        .animate-fin-flap-right { animation: fin-flap-left 2s infinite ease-in-out alternate-reverse; }
      `}</style>
    </div>
  );
}
