"use client";

import React, { use, useEffect, useState } from "react";
import { ArrowLeft, Users, Trophy, Loader2 } from "lucide-react";
import Link from "next/link";
// 🦈 1. Importar o componente Image
import Image from "next/image";
import { fetchTurmaRankingUsers } from "../../../lib/rankingService";
import { getTurmaImage } from "../../../constants/turmaImages";

interface User {
  id: string;
  nome: string;
  xp: number;
  foto: string;
  turma: string;
  apelido?: string;
}

export default function TurmaRankingPage({
  params,
}: {
  params: Promise<{ turmaId: string }>;
}) {
  const { turmaId } = use(params);
  
  // Decodifica a URL (ex: "T5" vem limpo, mas previne %20)
  const turmaReal = decodeURIComponent(turmaId);

  const [alunos, setAlunos] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
      async function fetchTurmaData() {
          try {
              const data = (await fetchTurmaRankingUsers({
                  turma: turmaReal,
                  maxResults: 50,
                  forceRefresh: false,
              })).map((entry) => ({
                  id: entry.id,
                  nome: entry.nome || "Anonimo",
                  apelido: entry.apelido || "",
                  xp: entry.xp || 0,
                  foto: entry.foto || "https://github.com/shadcn.png",
                  turma: entry.turma || turmaReal,
              })) as User[];

              setAlunos(data);
          } catch (error: unknown) {
              console.error("Erro ao carregar turma. Verifique indices do Firestore.", error);
          } finally {
              setLoading(false);
          }
      }

      void fetchTurmaData();
  }, [turmaReal]);
  // Calcular total de pontos da turma
  const totalPontos = alunos.reduce((acc, curr) => acc + curr.xp, 0);

  if (loading) {
      return (
        <div className="min-h-screen bg-[#050505] flex items-center justify-center text-emerald-500 gap-2 font-bold">
            <Loader2 className="animate-spin"/> Carregando Turma...
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      {/* Header */}
      <header className="p-6 sticky top-0 bg-[#050505]/90 backdrop-blur-md z-10 border-b border-zinc-900">
        <div className="flex items-center gap-4">
          <Link
            href="/ranking"
            className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-900 transition"
          >
            <ArrowLeft size={24} />
          </Link>
          <h1 className="font-black text-xl italic uppercase tracking-tighter">
            Ranking {turmaReal}
          </h1>
        </div>
      </header>

      <main className="p-4 space-y-6">
        {/* Banner da Turma */}
        <div className="bg-zinc-900 rounded-3xl p-6 border border-zinc-800 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-[#4ade80]/5 to-transparent"></div>
          <div className="relative z-10">
            <div className="w-20 h-20 mx-auto bg-white rounded-full p-1 mb-3 relative overflow-hidden">
              {/* 🦈 2. Substituição por Image Otimizada (Local) */}
              <Image
                src={getTurmaImage(turmaReal)}
                alt={`Brasão da Turma ${turmaReal}`}
                width={80}
                height={80}
                className="rounded-full object-cover"
                priority
                onError={(e) => (e.currentTarget.srcset = "/logo.png")} // Fallback simples
              />
            </div>
            <h2 className="text-2xl font-black italic uppercase tracking-tighter text-white">
              Turma {turmaReal}
            </h2>
            <div className="flex justify-center gap-4 mt-4 text-xs font-bold uppercase tracking-widest text-zinc-500">
              <span className="flex items-center gap-1">
                <Users size={14} /> {alunos.length} Alunos
              </span>
              <span className="flex items-center gap-1">
                <Trophy size={14} className="text-[#4ade80]" /> {totalPontos}{" "}
                Pts
              </span>
            </div>
          </div>
        </div>

        {/* Lista de Alunos */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1 mb-3">
            Classificação Interna
          </h3>

          {alunos.length > 0 ? (
            alunos.map((item, index) => (
              <Link
                key={item.id}
                href={`/perfil/${item.id}`}
                className="flex items-center gap-4 bg-zinc-900/50 p-3 rounded-2xl border border-zinc-800/50 hover:bg-zinc-800 transition active:scale-95"
              >
                <span
                  className={`text-sm font-black w-6 text-center ${
                    index === 0
                      ? "text-yellow-500"
                      : index === 1
                      ? "text-zinc-300"
                      : index === 2
                      ? "text-orange-700"
                      : "text-zinc-600"
                  }`}
                >
                  {index + 1}º
                </span>
                
                {/* 🦈 3. Substituição por Image com Unoptimized (Externo) */}
                <div className="relative w-10 h-10 rounded-full overflow-hidden bg-zinc-800 shrink-0">
                    <Image
                      src={item.foto}
                      alt={`Foto de ${item.nome}`}
                      width={40}
                      height={40}
                      className={`object-cover ${index === 0 ? "border-2 border-yellow-500" : ""}`}
                      unoptimized // Importante para evitar erro de configuração de domínio
                      onError={(e) => (e.currentTarget.srcset = "https://github.com/shadcn.png")}
                    />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{item.apelido || item.nome}</p>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">
                    Atleta da {item.turma}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-[#4ade80]">
                    {item.xp}
                  </p>
                  <p className="text-[8px] text-zinc-600 font-bold uppercase">
                    PTS
                  </p>
                </div>
              </Link>
            ))
          ) : (
            <div className="text-center py-10 text-zinc-500 text-sm">
              Nenhum aluno dessa turma pontuou ainda.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

