"use client";

import React, { useState, useEffect } from "react";
import { 
  ArrowLeft, Search, X, Loader2, Clock3
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { fetchArenaUsers } from "../../../lib/arenaService";
// 🦈 Importamos a calculadora oficial para garantir que o Admin vê a mesma coisa que o User
import { calculateUserStats } from "../../../lib/games"; 

// 🦈 Interface para tipagem segura
interface AdminUser {
    id: string;
    nome: string;
    turma: string;
    foto: string;
    stats?: Record<string, number>;
    [key: string]: unknown; // Flexibilidade para outros campos do Firestore
}

export default function AdminGamesPage() {
  // 🦈 Estados Tipados
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
      const fetchUsers = async () => {
          try {
            const usersRows = await fetchArenaUsers({
              maxResults: 80,
              forceRefresh: false,
            });
            setUsers(usersRows.map((row) => ({ ...row } as AdminUser)));
          } catch (error: unknown) {
            console.error("Erro ao buscar usuários", error);
          } finally {
            setLoading(false);
          }
      };
      fetchUsers();
  }, []);

  // Filtro ativo
  const filteredUsers = users.filter(u => u.nome?.toLowerCase().includes(searchTerm.toLowerCase()));

  if (loading) {
      return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500"/></div>;
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
       <header className="p-6 bg-zinc-900 border-b border-zinc-800 flex items-center gap-4">
          <Link href="/admin" className="p-2 bg-black rounded-full border border-zinc-700"><ArrowLeft size={20}/></Link>
          <h1 className="text-xl font-black uppercase text-emerald-500">Admin Arena</h1>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-300">
            <Clock3 size={12} /> Em breve
          </span>
       </header>

       <main className="p-6">
          <div className="mb-6 flex gap-2 items-center bg-zinc-900 p-3 rounded-xl border border-zinc-800">
              <Search className="text-zinc-500" size={20}/>
              <input 
                type="text" 
                placeholder="Buscar atleta..." 
                className="bg-transparent border-none outline-none text-white w-full text-sm" 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)}
              />
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              {filteredUsers.length === 0 && (
                  <div className="p-8 text-center text-zinc-500 text-sm">Nenhum atleta encontrado.</div>
              )}
              
              {/* 🦈 CORREÇÃO: Usando filteredUsers para renderizar a busca real */}
              {filteredUsers.map(u => (
                  <div key={u.id} onClick={() => setSelectedUser(u)} className="p-4 border-b border-zinc-800 hover:bg-zinc-800 cursor-pointer flex justify-between items-center transition">
                      <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-zinc-700 overflow-hidden relative">
                             <Image 
                                src={u.foto || "https://github.com/shadcn.png"} 
                                alt={u.nome || "User"} 
                                fill 
                                className="object-cover"
                                unoptimized
                             />
                          </div>
                          <div>
                              <p className="font-bold text-white text-sm">{u.nome}</p>
                              <p className="text-xs text-zinc-500">{u.turma}</p>
                          </div>
                      </div>
                      <span className="text-xs font-mono text-emerald-500">Ver Stats &gt;</span>
                  </div>
              ))}
          </div>
       </main>

       {/* MODAL AUDITORIA */}
       {selectedUser && (
           <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-in fade-in">
               <div className="bg-zinc-900 w-full max-w-md rounded-3xl border border-zinc-800 p-6 relative h-[80vh] overflow-y-auto">
                   <button onClick={() => setSelectedUser(null)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><X/></button>
                   <h2 className="text-xl font-black text-white mb-6 uppercase">{selectedUser.nome}</h2>
                   
                   {/* TABELA DE CÁLCULO */}
                   <div className="space-y-4">
                       {/* 🦈 Importante: calculateUserStats pode retornar qualquer coisa, garantimos a renderização */}
                       {Object.entries(calculateUserStats(selectedUser)).map(([stat, val]) => (
                           <div key={stat} className="bg-black p-3 rounded-xl border border-zinc-800">
                               <div className="flex justify-between mb-2">
                                   <span className="font-bold text-white uppercase text-sm">{stat}</span>
                                   <span className="text-emerald-500 font-black text-xl">{String(val)}</span>
                               </div>
                               <p className="text-[10px] text-zinc-500 break-all">
                                   Baseado em: {JSON.stringify(selectedUser.stats || {})}
                               </p>
                           </div>
                       ))}
                   </div>
               </div>
           </div>
       )}
    </div>
  );
}
