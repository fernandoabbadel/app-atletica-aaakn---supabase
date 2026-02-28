// src/app/gym/checkin/details/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { ArrowLeft, CheckCircle2, Tag, Type } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../../context/AuthContext";
import { useToast } from "../../../../context/ToastContext";
import { submitGymCheckin } from "../../../../lib/gymService";

const WORKOUT_TYPES = ["Musculação", "Crossfit", "Cardio / Corrida", "Natação", "Futevôlei", "Luta / Artes Marciais", "Dança", "Outros"];

export default function CheckinDetailsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [photo, setPhoto] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const savedPhoto = localStorage.getItem("tempCheckinPhoto");
    if (savedPhoto) setPhoto(savedPhoto);
    else router.push("/gym/checkin");
  }, [router]);

  const handleFinish = async () => {
    if (!selectedType || !customTitle.trim() || !user || !photo) return;

    setIsSubmitting(true);

    try {
        await submitGymCheckin({
            userId: user.uid,
            userName: user.nome || "Atleta AAAKN",
            userAvatar: user.foto || "https://github.com/shadcn.png",
            selectedType,
            title: customTitle,
            photoDataUrl: photo,
        });

        localStorage.removeItem("tempCheckinPhoto");
        addToast("Treino validado! +50 XP", "success");
        router.push("/gym");

    } catch (error: unknown) {
        console.error("Erro ao publicar:", error);
        addToast("Erro ao postar treino. Tente novamente.", "error");
    } finally {
        setIsSubmitting(false);
    }
  };
  if (!photo) return null;

  const isValid = selectedType !== "" && customTitle.trim().length > 0;

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col">
      <header className="p-4 flex items-center gap-4 sticky top-0 bg-black z-10">
        <Link href="/gym/checkin" className="text-zinc-400 hover:text-white">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="font-bold text-lg">Detalhes do Treino</h1>
      </header>

      <main className="flex-1 p-6 space-y-8 overflow-y-auto">
        <div className="flex flex-col items-center">
          <div className="w-40 h-40 rounded-3xl overflow-hidden border-2 border-zinc-800 shadow-2xl rotate-3 relative">
            <Image 
                src={photo} 
                alt="Check-in preview" 
                fill
                sizes="160px"
                className="object-cover" 
                
            />
          </div>
          <p className="text-[10px] text-zinc-500 mt-2 font-bold uppercase tracking-widest">
            Foto Capturada
          </p>
        </div>

        {/* Tipo de Treino */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-bold text-[#4ade80] uppercase tracking-widest">
            <Tag size={14} /> O que você treinou hoje?
          </label>
          <div className="grid grid-cols-2 gap-2">
            {WORKOUT_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`py-3 px-2 rounded-xl text-xs font-bold transition-all border ${
                  selectedType === type
                    ? "bg-[#4ade80] text-black border-[#4ade80]"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Título (OBRIGATÓRIO) */}
        <div className="space-y-3">
          <div className="flex justify-between items-end">
            <label className="flex items-center gap-2 text-xs font-bold text-[#4ade80] uppercase tracking-widest">
              <Type size={14} /> Título do Treino (Obrigatório)
            </label>
            <span className={`text-[10px] font-bold ${customTitle.length === 20 ? "text-red-500" : "text-zinc-600"}`}>
              {customTitle.length}/20
            </span>
          </div>
          <input
            type="text"
            maxLength={20}
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="Ex: Legday Monstro 🍗"
            className={`w-full bg-zinc-900 border rounded-xl p-4 text-white placeholder-zinc-600 focus:outline-none transition ${
              !customTitle && "border-red-900/50 focus:border-red-500"
            } ${customTitle && "border-zinc-800 focus:border-[#4ade80]"}`}
          />
        </div>
      </main>

      <div className="p-6 bg-black border-t border-zinc-900">
        <button
          onClick={handleFinish}
          disabled={!isValid || isSubmitting}
          className={`w-full py-4 rounded-2xl font-black uppercase italic tracking-widest flex items-center justify-center gap-2 transition-all ${
            !isValid || isSubmitting
              ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              : "bg-[#4ade80] text-black hover:scale-[1.02] shadow-[0_0_20px_rgba(74,222,128,0.3)]"
          }`}
        >
          {isSubmitting ? (
            "Postando..."
          ) : (
            <>
              <CheckCircle2 size={20} /> Confirmar Check-in
            </>
          )}
        </button>
      </div>
    </div>
  );
}

