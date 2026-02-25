// src/app/historico/page.tsx
"use client";

import Image from "next/image";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, MapPin, Trophy, ChevronRight, CalendarRange, Loader2 } from "lucide-react";
import {
  fetchHistoricEvents,
  fetchHistoryPageConfig,
  type HistoricEventRecord,
  type HistoryPageConfig,
} from "../../lib/historyService";

// Interface para garantir tipagem forte
type HistoricEvent = HistoricEventRecord;
type PageConfig = HistoryPageConfig;

export default function HistoricoPage() {
  const [events, setEvents] = useState<HistoricEvent[]>([]);
  const [config, setConfig] = useState<PageConfig>({
    tituloPagina: "Nossa História",
    subtituloPagina: "Carregando legado...",
    fotoCapa: ""
  });
  const [loading, setLoading] = useState(true);

  // 1. Buscar Configurações e Eventos com leitura controlada
  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      setLoading(true);
      try {
        const [configData, eventsData] = await Promise.all([
          fetchHistoryPageConfig(),
          fetchHistoricEvents({ order: "asc", maxResults: 200 }),
        ]);

        if (!mounted) return;
        if (configData) {
          setConfig(configData);
        }
        setEvents(eventsData);
      } catch (error: unknown) {
        console.error("Erro ao carregar histórico:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadData();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-emerald-500 gap-4">
        <Loader2 className="animate-spin" size={48} />
        <p className="text-xs font-black uppercase tracking-widest animate-pulse">Resgatando Arquivos...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-32 font-sans selection:bg-emerald-500">
      
      {/* HEADER DINÂMICO */}
      <div className="relative h-72 w-full overflow-hidden flex items-center justify-center bg-zinc-900 group">
          {/* Imagem de Capa do Banco */}
          {config.fotoCapa && (
            <div className="absolute inset-0 z-0">
              <Image 
                src={config.fotoCapa} 
                alt="Capa da página de histórico" 
                fill // O tubarão usou fill para cobrir todo o container pai (substitui w-full h-full)
                className="object-cover opacity-40 group-hover:scale-105 transition duration-1000"
                sizes="(max-width: 768px) 100vw, 100vw" // Otimização de carregamento para mobile/desktop
              />
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#050505]/60 to-[#050505] z-10"></div>
          
       <div className="relative z-20 flex flex-col items-center animate-in zoom-in-50 duration-700 px-4 text-center">
            {/* Adicionado 'relative' nesta div abaixo para conter o fill */}
            <div className="relative w-24 h-24 md:w-32 md:h-32 bg-black/50 backdrop-blur-xl rounded-full border-4 border-emerald-500/30 p-4 shadow-[0_0_40px_rgba(16,185,129,0.2)] mb-4">
                <Image 
                    src="/logo.png" 
                    fill
                    sizes="(max-width: 768px) 96px, 128px"
                    className="object-contain drop-shadow-xl p-1" 
                    alt="Logo AAAKN" 
                    priority // Carregamento prioritário para logo principal
                />
            </div>
            <h1 className="text-3xl md:text-4xl font-black uppercase italic tracking-tighter text-white drop-shadow-xl">
                {config.tituloPagina.split(' ').slice(0, -1).join(' ')} <span className="text-emerald-500">{config.tituloPagina.split(' ').slice(-1)}</span>
            </h1>
            <p className="text-zinc-400 text-xs md:text-sm font-medium mt-2 max-w-lg">{config.subtituloPagina}</p>
      </div>
          
          <div className="absolute top-6 left-6 z-30">
              <Link href="/dashboard" className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-emerald-600 transition border border-white/10 active:scale-95">
                <ArrowLeft size={20}/>
              </Link>
          </div>
      </div>

      {/* TIMELINE CONTAINER */}
      <div className="max-w-4xl mx-auto px-4 mt-8 relative">
          
          {/* LINHA CENTRAL */}
          <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-500 via-zinc-800 to-transparent"></div>

          <div className="space-y-12">
              {events.length === 0 ? (
                  <div className="text-center py-20 text-zinc-600 font-bold uppercase italic">
                      Nenhuma história contada ainda...
                  </div>
              ) : (
                  events.map((event, index) => {
                      const isEven = index % 2 === 0;
                      return (
                          <div key={event.id} className={`relative flex flex-col md:flex-row items-start md:items-center ${isEven ? 'md:flex-row-reverse' : ''}`}>
                              
                              {/* BOLINHA */}
                              <div className="absolute left-4 md:left-1/2 -translate-x-[5px] md:-translate-x-1/2 w-3 h-3 bg-emerald-500 rounded-full border-2 border-black shadow-[0_0_10px_rgba(16,185,129,0.8)] z-10 mt-1.5 md:mt-0"></div>

                              {/* CARD */}
                              <div className={`pl-10 md:pl-0 w-full md:w-1/2 ${isEven ? 'md:pr-12' : 'md:pl-12'}`}>
                                  <div className="bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 rounded-2xl overflow-hidden group hover:border-emerald-500/50 transition duration-300 shadow-xl">
                                      
                                 {/* FOTO DO EVENTO */}
    <div className="h-40 w-full overflow-hidden relative bg-black">
        <Image 
            src={event.foto || "https://via.placeholder.com/400x200?text=Sem+Foto"} 
            alt={`Foto do evento ${event.titulo}`}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover group-hover:scale-110 transition duration-700"
            // Nota: onError não funciona igual no Image component, recomenda-se tratar a URL antes ou usar um componente wrapper, mas o src com fallback (||) já ajuda.
        />
        <div className="absolute top-3 right-3 bg-black/70 backdrop-blur px-3 py-1 rounded-full border border-white/10 shadow-lg z-10">
            <span className="text-xs font-black text-emerald-400">{event.ano}</span>
        </div>
    </div>

                                      <div className="p-5">
                                          <h3 className="text-xl font-black uppercase text-white mb-2 leading-tight">{event.titulo}</h3>
                                          <div className="flex flex-wrap items-center gap-4 text-[10px] font-bold text-zinc-500 uppercase mb-3">
                                              <span className="flex items-center gap-1"><Calendar size={12} className="text-emerald-600"/> {new Date(event.data).toLocaleDateString('pt-BR')}</span>
                                              <span className="flex items-center gap-1"><MapPin size={12} className="text-emerald-600"/> {event.local}</span>
                                          </div>
                                          <p className="text-sm text-zinc-400 leading-relaxed border-t border-zinc-800 pt-3 line-clamp-4">
                                              {event.descricao}
                                          </p>
                                      </div>
                                  </div>
                              </div>

                              {/* Espaçador Desktop */}
                              <div className="w-full md:w-1/2 hidden md:block"></div>
                          </div>
                      );
                  })
              )}
          </div>

          {/* FOOTER */}
          <div className="mt-16 mb-8 flex flex-col items-center gap-6">
              <div className="inline-block p-4 bg-zinc-900 rounded-full border border-zinc-800 text-zinc-500 animate-bounce">
                  <Trophy size={24} className="text-yellow-500"/>
              </div>
              
              <Link href="/eventos" className="relative group w-full max-w-sm">
                  <div className="absolute -inset-1 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl blur opacity-40 group-hover:opacity-100 transition duration-500 animate-pulse"></div>
                  <button className="relative w-full bg-zinc-900 ring-1 ring-white/10 rounded-xl px-6 py-4 flex items-center justify-between overflow-hidden">
                      <div className="flex items-center gap-4">
                          <div className="bg-emerald-500/20 p-2 rounded-lg text-emerald-400">
                              <CalendarRange size={24} />
                          </div>
                          <div className="text-left">
                              <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Próximos Passos</p>
                              <h3 className="text-lg font-black text-white italic uppercase">Agenda do Tubarão</h3>
                          </div>
                      </div>
                      <ChevronRight className="text-zinc-500 group-hover:text-white group-hover:translate-x-1 transition"/>
                  </button>
              </Link>
          </div>
      </div>
    </div>
  );
}
