"use client";

import React, { useState, useEffect } from "react";
import { ArrowLeft, Users, User, Crown, Loader2 } from "lucide-react"; // 🦈 Removido 'Trophy' não utilizado
import Link from "next/link";
import Image from "next/image"; // 🦈 Importando Image do Next.js
import { fetchGlobalRankingUsers } from "../../lib/rankingService";
import { getTurmaImage } from "../../constants/turmaImages";

// Interface para o Usuário vindo do Supabase
interface RankingUser {
  id: string;
  nome: string;
  xp: number;
  foto: string;
  turma: string;
  apelido?: string;
}

// Interface para a Turma Agregada
interface RankingTurma {
  id: string;
  nome: string;
  pontos: number;
  membros: number;
  logo: string;
}

export default function RankingPage() {
  const [activeTab, setActiveTab] = useState<"individual" | "turma">("individual");
  const [users, setUsers] = useState<RankingUser[]>([]);
  const [turmas, setTurmas] = useState<RankingTurma[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRanking() {
      try {
        const usersData = (await fetchGlobalRankingUsers({
          maxResults: 100,
          forceRefresh: false,
        })).map((entry) => ({
          id: entry.id,
          nome: entry.nome || "Atleta Anonimo",
          apelido: entry.apelido || "",
          xp: entry.xp || 0,
          foto: entry.foto || "https://github.com/shadcn.png",
          turma: entry.turma || "Geral",
        })) as RankingUser[];

        setUsers(usersData);

        const turmasMap: Record<string, RankingTurma> = {};

        usersData.forEach(user => {
            const turmaKey = user.turma ? user.turma.toUpperCase().trim() : "GERAL";
            
            if (!turmasMap[turmaKey]) {
                turmasMap[turmaKey] = {
                    id: turmaKey,
                    nome: `${turmaKey}`,
                    pontos: 0,
                    membros: 0,
                    logo: getTurmaImage(turmaKey)
                };
            }
            turmasMap[turmaKey].pontos += user.xp;
            turmasMap[turmaKey].membros += 1;
        });

        const turmasSorted = Object.values(turmasMap).sort((a, b) => b.pontos - a.pontos);
        setTurmas(turmasSorted);

      } catch (error: unknown) {
        console.error("Erro ao carregar ranking:", error);
      } finally {
        setLoading(false);
      }
    }

    void fetchRanking();
  }, []);
  // Seleciona a lista baseada na aba
  const dataList = activeTab === "individual" ? users : turmas;
  const top3 = dataList.slice(0, 3);
  const restList = dataList.slice(3);

  // 🦈 Helper para pegar imagem segura
  const getImageSrc = (item: RankingUser | RankingTurma) => {
    if (activeTab === "individual") return (item as RankingUser).foto;
    return (item as RankingTurma).logo;
  };

  // 🦈 Helper para pegar o fallback de imagem no erro
  const getFallbackImage = () => {
    return activeTab === "individual" ? "https://github.com/shadcn.png" : "/logo.png";
  };

  if (loading) {
      return (
        <div className="min-h-screen bg-[#050505] flex items-center justify-center text-emerald-500 font-bold gap-2">
            <Loader2 className="animate-spin"/> Calculando Ranking...
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      {/* Header */}
      <header className="p-6 sticky top-0 bg-[#050505]/90 backdrop-blur-md z-10 border-b border-zinc-900">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/dashboard"
            className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-900 transition"
          >
            <ArrowLeft size={24} />
          </Link>
          <h1 className="font-black text-xl italic uppercase tracking-tighter">
            Ranking Geral
          </h1>
        </div>

        {/* Tabs */}
        <div className="flex bg-zinc-900/50 p-1 rounded-2xl border border-zinc-800">
          <button
            onClick={() => setActiveTab("individual")}
            className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
              activeTab === "individual"
                ? "bg-[#4ade80] text-black shadow-lg"
                : "text-zinc-500 hover:text-white"
            }`}
          >
            <User size={16} /> Individual
          </button>
          <button
            onClick={() => setActiveTab("turma")}
            className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
              activeTab === "turma"
                ? "bg-[#4ade80] text-black shadow-lg"
                : "text-zinc-500 hover:text-white"
            }`}
          >
            <Users size={16} /> Por Turma
          </button>
        </div>
      </header>

      <main className="p-4 space-y-4">
        {dataList.length === 0 ? (
            <div className="text-center text-zinc-500 mt-10">Nenhum dado encontrado no ranking.</div>
        ) : (
            <>
                {/* PODIUM (Top 3) */}
                {top3.length >= 1 && (
                <div className="flex justify-center items-end gap-4 mb-8 pt-4">
                
                {/* 2º Lugar */}
                {top3[1] && (
                    <div className="flex flex-col items-center">
                        <div className="relative">
                        <Link href={activeTab === "individual" ? `/perfil/${top3[1]?.id}` : `/ranking/${top3[1]?.id}`}>
                            <Image
                                src={getImageSrc(top3[1])}
                                alt="2º Lugar"
                                width={64}
                                height={64}
                                sizes="64px"
                                className="rounded-full border-4 border-zinc-400 object-cover cursor-pointer hover:scale-105 transition bg-zinc-800"
                                onError={(e) => (e.currentTarget.src = getFallbackImage())}
                            />
                        </Link>
                        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-zinc-400 text-black text-[10px] font-black px-2 py-0.5 rounded-full border border-black shadow-lg">2º</div>
                        </div>
                        <p className="mt-4 text-xs font-bold text-zinc-300 w-20 text-center truncate">{activeTab === "individual" ? (top3[1] as RankingUser).apelido || top3[1].nome.split(' ')[0] : top3[1].nome}</p>
                        <p className="text-[10px] text-zinc-500 font-bold">
                            {activeTab === "individual" ? (top3[1] as RankingUser)?.xp : (top3[1] as RankingTurma)?.pontos} pts
                        </p>
                    </div>
                )}

                {/* 1º Lugar */}
                <div className="flex flex-col items-center -mt-8">
                    <div className="relative">
                    <Crown size={28} className="text-yellow-500 absolute -top-9 left-1/2 -translate-x-1/2 animate-bounce drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]" fill="currentColor" />
                    <Link href={activeTab === "individual" ? `/perfil/${top3[0].id}` : `/ranking/${top3[0].id}`}>
                        <Image
                            src={getImageSrc(top3[0])}
                            alt="1º Lugar"
                            width={96}
                            height={96}
                            sizes="96px"
                            priority
                            className="rounded-full border-4 border-yellow-500 object-cover shadow-[0_0_40px_rgba(234,179,8,0.4)] cursor-pointer hover:scale-105 transition bg-zinc-800"
                            onError={(e) => (e.currentTarget.src = getFallbackImage())}
                        />
                    </Link>
                    <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-yellow-500 text-black text-xs font-black px-3 py-0.5 rounded-full border-2 border-black shadow-lg">1º</div>
                    </div>
                    <p className="mt-5 text-sm font-black text-white w-28 text-center truncate">{activeTab === "individual" ? (top3[0] as RankingUser).apelido || top3[0].nome.split(' ')[0] : top3[0].nome}</p>
                    <p className="text-xs text-yellow-500 font-bold">
                        {activeTab === "individual" ? (top3[0] as RankingUser).xp : (top3[0] as RankingTurma).pontos} pts
                    </p>
                </div>

                {/* 3º Lugar */}
                {top3[2] && (
                    <div className="flex flex-col items-center">
                    <div className="relative">
                        <Link href={activeTab === "individual" ? `/perfil/${top3[2].id}` : `/ranking/${top3[2].id}`}>
                        <Image
                            src={getImageSrc(top3[2])}
                            alt="3º Lugar"
                            width={64}
                            height={64}
                            sizes="64px"
                            className="rounded-full border-4 border-amber-700 object-cover cursor-pointer hover:scale-105 transition bg-zinc-800"
                            onError={(e) => (e.currentTarget.src = getFallbackImage())}
                        />
                        </Link>
                        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-amber-700 text-white text-[10px] font-black px-2 py-0.5 rounded-full border border-black shadow-lg">3º</div>
                    </div>
                    <p className="mt-4 text-xs font-bold text-zinc-300 w-20 text-center truncate">{activeTab === "individual" ? (top3[2] as RankingUser).apelido || top3[2].nome.split(' ')[0] : top3[2].nome}</p>
                    <p className="text-[10px] text-zinc-500 font-bold">
                        {activeTab === "individual" ? (top3[2] as RankingUser).xp : (top3[2] as RankingTurma).pontos} pts
                    </p>
                    </div>
                )}
                </div>
                )}

                {/* LISTA RESTANTE */}
                <div className="space-y-2 pb-10">
                {restList.map((item, index) => (
                    <Link
                    key={item.id}
                    href={activeTab === "individual" ? `/perfil/${item.id}` : `/ranking/${item.id}`}
                    className="flex items-center gap-4 bg-zinc-900/50 p-3 rounded-2xl border border-zinc-800/50 hover:bg-zinc-800 transition active:scale-95"
                    >
                    <span className="text-sm font-black text-zinc-600 w-6 text-center">{index + 4}º</span>
                    <Image
                        src={getImageSrc(item)}
                        alt={`Foto de ${item.nome}`}
                        width={40}
                        height={40}
                        sizes="40px"
                        className="rounded-full object-cover bg-zinc-800 w-10 h-10" // Forçando w/h no css também
                        onError={(e) => (e.currentTarget.src = getFallbackImage())}
                    />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">{activeTab === "individual" ? (item as RankingUser).nome : item.nome}</p>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase">
                        {/* 🦈 Correção da tipagem aqui: Cast explícito para evitar 'any' */}
                        {activeTab === "individual"
                            ? `Turma ${(item as RankingUser).turma}`
                            : `${(item as RankingTurma).membros} Membros`}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-sm font-black text-[#4ade80]">
                        {activeTab === "individual" ? (item as RankingUser).xp : (item as RankingTurma).pontos}
                        </p>
                        <p className="text-[8px] text-zinc-600 font-bold uppercase">
                        PTS
                        </p>
                    </div>
                    </Link>
                ))}
                </div>
            </>
        )}
      </main>
    </div>
  );
}

