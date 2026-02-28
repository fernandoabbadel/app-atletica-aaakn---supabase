"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Bus,
  Phone,
  ExternalLink,
  Landmark,
  GraduationCap,
  BookOpen,
  Users,
} from "lucide-react";
import Link from "next/link";

import { type GuideCategory } from "../../lib/guiaService";

export type GuiaItem = {
  id: string;
  categoria: GuideCategory;
  ordem?: number;
  titulo?: string;
  url?: string;
  nome?: string;
  horario?: string;
  detalhe?: string;
  descricao?: string;
  foto?: string;
  numero?: string;
  cor?: string;
};

export type GuiaState = {
  academico: GuiaItem[];
  transporte: GuiaItem[];
  turismo: GuiaItem[];
  emergencia: GuiaItem[];
  grupos: GuiaItem[];
};

type CategoriaConfig = {
  label: string;
  icon: React.ReactNode;
  color: string;
};

const CATEGORIAS_CONFIG: Record<GuideCategory, CategoriaConfig> = {
  academico: { label: "Academico", icon: <GraduationCap size={18} />, color: "text-emerald-500" },
  transporte: { label: "Transporte", icon: <Bus size={18} />, color: "text-orange-500" },
  turismo: { label: "Turismo", icon: <Landmark size={18} />, color: "text-blue-500" },
  emergencia: { label: "Emergencia", icon: <Phone size={18} />, color: "text-red-500" },
  grupos: { label: "Grupos", icon: <Users size={18} />, color: "text-cyan-400" },
};

interface GuiaClientPageProps {
  initialGuiaData: GuiaState;
}

export default function GuiaClientPage({ initialGuiaData }: GuiaClientPageProps) {
  const [guiaData] = useState<GuiaState>(initialGuiaData);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-24 selection:bg-emerald-500/30">
      <header className="p-4 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md flex items-center gap-3 border-b border-zinc-900">
        <Link
          href="/"
          className="p-2 -ml-2 text-zinc-400 hover:text-white transition rounded-full hover:bg-zinc-900"
        >
          <ArrowLeft size={24} />
        </Link>
        <h1 className="font-black text-lg uppercase tracking-wide flex items-center gap-2">
          <BookOpen size={20} className="text-emerald-500" /> Guia do Bixo
        </h1>
      </header>

      <main className="p-4 space-y-8">
        {guiaData.academico.length > 0 && (
          <section>
            <h2 className={`text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2 ${CATEGORIAS_CONFIG.academico.color}`}>
              {CATEGORIAS_CONFIG.academico.icon} {CATEGORIAS_CONFIG.academico.label}
            </h2>
            <div className="grid gap-3 grid-cols-1">
              {guiaData.academico.map((item) => (
                <LinkButton key={item.id} texto={item.titulo || "Link"} url={item.url || "#"} />
              ))}
            </div>
          </section>
        )}

        {guiaData.grupos.length > 0 && (
          <section>
            <h2 className={`text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2 ${CATEGORIAS_CONFIG.grupos.color}`}>
              {CATEGORIAS_CONFIG.grupos.icon} {CATEGORIAS_CONFIG.grupos.label}
            </h2>
            <div className="grid gap-3 grid-cols-1">
              {guiaData.grupos.map((item) => (
                <LinkButton key={item.id} texto={item.titulo || "Grupo"} url={item.url || "#"} />
              ))}
            </div>
          </section>
        )}

        {guiaData.transporte.length > 0 && (
          <section>
            <h2 className={`text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2 ${CATEGORIAS_CONFIG.transporte.color}`}>
              {CATEGORIAS_CONFIG.transporte.icon} {CATEGORIAS_CONFIG.transporte.label}
            </h2>
            <div className="grid gap-3 grid-cols-1">
              {guiaData.transporte.map((item) => (
                <div key={item.id} className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 space-y-3 hover:border-zinc-700 transition">
                  <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                    <span className="font-bold text-white">{item.nome}</span>
                    <span className="text-[10px] font-bold px-2 py-1 rounded bg-emerald-500/10 text-emerald-500">
                      Horarios
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300 font-mono bg-black/30 p-2 rounded border border-zinc-800">{item.horario}</p>
                  <p className="text-xs text-zinc-400 leading-relaxed">{item.detalhe}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {guiaData.turismo.length > 0 && (
          <section>
            <h2 className={`text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2 ${CATEGORIAS_CONFIG.turismo.color}`}>
              {CATEGORIAS_CONFIG.turismo.icon} {CATEGORIAS_CONFIG.turismo.label}
            </h2>
            <div className="grid gap-3 grid-cols-2">
              {guiaData.turismo.map((item) => (
                <CardTurismo
                  key={item.id}
                  nome={item.nome || "Local"}
                  desc={item.descricao || ""}
                  img={item.foto || ""}
                />
              ))}
            </div>
          </section>
        )}

        {guiaData.emergencia.length > 0 && (
          <section>
            <h2 className={`text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2 ${CATEGORIAS_CONFIG.emergencia.color}`}>
              {CATEGORIAS_CONFIG.emergencia.icon} {CATEGORIAS_CONFIG.emergencia.label}
            </h2>
            <div className="grid gap-3 grid-cols-2">
              {guiaData.emergencia.map((item) => (
                <div key={item.id} className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl text-center hover:bg-zinc-900 transition cursor-pointer">
                  <span className={`block font-black text-2xl mb-1 ${item.cor === "red" ? "text-red-500" : "text-zinc-400"}`}>
                    {item.numero}
                  </span>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">
                    {item.nome}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function LinkButton({ texto, url }: { texto: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex justify-between items-center bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700 transition rounded-xl p-4 group"
    >
      <span className="font-bold text-white group-hover:text-emerald-400 transition">{texto}</span>
      <ExternalLink size={18} className="text-zinc-600 group-hover:text-emerald-500 transition" />
    </a>
  );
}

function CardTurismo({ nome, desc, img }: { nome: string; desc: string; img: string }) {
  const [src, setSrc] = useState(img || "https://via.placeholder.com/150");

  return (
    <div className="relative h-32 rounded-xl overflow-hidden group cursor-pointer border border-zinc-800 hover:border-emerald-500/50 transition">
      <Image
        src={src}
        alt={nome}
        fill
        className="object-cover opacity-60 group-hover:opacity-80 group-hover:scale-110 transition duration-700"
        onError={() => setSrc("https://via.placeholder.com/150?text=Sem+Foto")}
        
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
      <div className="absolute bottom-3 left-3 right-3">
        <span className="block text-white font-bold text-sm mb-0.5 group-hover:text-emerald-400 transition">{nome}</span>
        <span className="block text-zinc-400 text-[10px] font-medium truncate">{desc}</span>
      </div>
    </div>
  );
}
