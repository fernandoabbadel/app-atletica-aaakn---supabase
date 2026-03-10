"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { X, Syringe, Stethoscope, Trophy } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  title: string;
  message: string;
  type: ToastType;
}

interface ToastContextData {
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextData>({} as ToastContextData);

const TITLES = {
  success: ["Aí sim, Doutor! 🩺", "Receba! 🦈", "O Tubarão te ama! 💙", "Golaço do Bixo! ⚽", "Aprovado pelo CRM! ✅", "Deu Green! 🤑"],
  error: ["Deu B.O. no plantão! 🚨", "Errou a dosagem? 💊", "Queixou, hein? 🤕", "Deu ruim, pô! 💀", "Paciente em parada! 💔", "Zicou o rolê... 🫠"],
  info: ["Se liga na visão! 👀", "Plantão informa: 📢", "Bizu de prova! 📝", "Atenção, calouro! 👶", "Notícias do Mar! 🌊"],
};

function getRandomTitle(type: ToastType) {
  const options = TITLES[type];
  return options[Math.floor(Math.random() * options.length)];
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // 🦈 1. Defini o removeToast PRIMEIRO para poder ser usado no addToast sem erro
  const removeToast = useCallback((id: string) => {
    setToasts((state) => state.filter((toast) => toast.id !== id));
  }, []);

  // 🦈 2. Agora o addToast conhece o removeToast e o inclui nas dependências
  const addToast = useCallback((message: string, type: ToastType = "success") => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const title = getRandomTitle(type);
    
    const newToast = { id, title, message, type };
    
    setToasts((state) => [...state, newToast]);
    
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]); // Dependência adicionada corretamente

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 w-full max-w-md px-4 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto relative overflow-hidden flex items-start gap-4 p-5 rounded-3xl border-2 backdrop-blur-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] transition-all animate-in slide-in-from-top-full zoom-in-95 duration-300 ${
              toast.type === "success" ? "bg-[#050505]/95 border-brand shadow-brand" : 
              toast.type === "error" ? "bg-[#050505]/95 border-red-500/50 shadow-red-900/40" : 
              "bg-[#050505]/95 border-brand shadow-brand"
            }`}
          >
            <div className={`p-3 rounded-2xl shrink-0 ${toast.type === "success" ? "bg-brand-solid text-black" : toast.type === "error" ? "bg-red-500 text-white" : "bg-brand-solid text-black"}`}>
              {toast.type === "success" && <Trophy size={24} strokeWidth={2.5} />}
              {toast.type === "error" && <Syringe size={24} strokeWidth={2.5} />}
              {toast.type === "info" && <Stethoscope size={24} strokeWidth={2.5} />}
            </div>
            <div className="flex-1 pt-0.5">
              <h4 className={`text-sm font-black uppercase tracking-wider mb-1 ${toast.type === "success" ? "text-brand" : toast.type === "error" ? "text-red-500" : "text-brand"}`}>{toast.title}</h4>
              <p className="text-zinc-300 text-sm font-medium leading-relaxed">{toast.message}</p>
            </div>
            <button onClick={() => removeToast(toast.id)} className="text-zinc-500 hover:text-white transition p-1 bg-white/5 rounded-full hover:bg-white/20"><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}
