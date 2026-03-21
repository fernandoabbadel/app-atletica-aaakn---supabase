"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

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

const TITLES: Record<ToastType, string[]> = {
  success: ["Tudo certo", "Sucesso", "Concluido", "Atualizado", "Fechado"],
  error: [
    "Algo deu errado",
    "Nao consegui concluir",
    "Falha na acao",
    "Precisamos tentar de novo",
    "Erro na operacao",
  ],
  info: ["Aviso rapido", "Atualizacao", "Importante", "Info do sistema", "Resumo"],
};

function getRandomTitle(type: ToastType): string {
  const options = TITLES[type];
  return options[Math.floor(Math.random() * options.length)];
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((state) => state.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = "success") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const title = getRandomTitle(type);
      const nextToast = { id, title, message, type };

      setToasts((state) => [...state, nextToast]);

      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="pointer-events-none fixed left-1/2 top-6 z-[9999] flex w-full max-w-md -translate-x-1/2 flex-col gap-3 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto relative flex items-start gap-4 overflow-hidden rounded-3xl border-2 p-5 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] backdrop-blur-2xl transition-all animate-in slide-in-from-top-full zoom-in-95 duration-300 ${
              toast.type === "success"
                ? "border-brand bg-[#050505]/95 shadow-brand"
                : toast.type === "error"
                  ? "border-red-500/50 bg-[#050505]/95 shadow-red-900/40"
                  : "border-brand bg-[#050505]/95 shadow-brand"
            }`}
          >
            <div
              className={`shrink-0 rounded-2xl p-3 ${
                toast.type === "success"
                  ? "bg-brand-solid text-black"
                  : toast.type === "error"
                    ? "bg-red-500 text-white"
                    : "bg-brand-solid text-black"
              }`}
            >
              {toast.type === "success" && <CheckCircle2 size={24} strokeWidth={2.5} />}
              {toast.type === "error" && <AlertTriangle size={24} strokeWidth={2.5} />}
              {toast.type === "info" && <Info size={24} strokeWidth={2.5} />}
            </div>
            <div className="flex-1 pt-0.5">
              <h4
                className={`mb-1 text-sm font-black uppercase tracking-wider ${
                  toast.type === "success"
                    ? "text-brand"
                    : toast.type === "error"
                      ? "text-red-500"
                      : "text-brand"
                }`}
              >
                {toast.title}
              </h4>
              <p className="text-sm font-medium leading-relaxed text-zinc-300">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="rounded-full bg-white/5 p-1 text-zinc-500 transition hover:bg-white/20 hover:text-white"
            >
              <X size={16} />
            </button>
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
