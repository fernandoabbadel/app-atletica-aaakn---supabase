"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Save,
  Image as ImageIcon,
  CreditCard,
  Calendar,
  Loader2,
  CheckCircle2,
  Info,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useToast } from "../../../context/ToastContext";
import {
  fetchCarteirinhaConfig,
  saveCarteirinhaConfig,
  uploadCarteirinhaBackground,
  type CarteirinhaConfig,
} from "../../../lib/carteirinhaService";

const TURMAS_LIST = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"];

const DEFAULT_CONFIG: CarteirinhaConfig = {
  validade: "DEZ/2026",
  backgrounds: {},
};

export default function AdminCarteirinhaPage() {
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingTurma, setUploadingTurma] = useState<string | null>(null);
  const [config, setConfig] = useState<CarteirinhaConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let mounted = true;

    const loadConfig = async () => {
      try {
        const loadedConfig = await fetchCarteirinhaConfig();
        if (mounted) setConfig(loadedConfig);
      } catch (error: unknown) {
        console.error("Erro ao carregar config:", error);
        if (mounted) addToast("Erro ao carregar configuracoes.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadConfig();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  const handleImageUpload = async (turma: string, file: File) => {
    setUploadingTurma(turma);
    try {
      const url = await uploadCarteirinhaBackground(turma, file);

      setConfig((prev) => ({
        ...prev,
        backgrounds: {
          ...prev.backgrounds,
          [turma]: url,
        },
      }));

      addToast(`Fundo da ${turma} personalizado!`, "success");
    } catch (error: unknown) {
      console.error("Erro no upload:", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao enviar imagem.";
      addToast(message, "error");
    } finally {
      setUploadingTurma(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveCarteirinhaConfig(config);
      addToast("Configuracoes salvas!", "success");
    } catch (error: unknown) {
      console.error("Erro ao salvar:", error);
      addToast("Erro ao salvar.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center text-emerald-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-20 font-sans selection:bg-emerald-500">
      <header className="p-6 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link
            href="/admin"
            className="bg-zinc-900 p-3 rounded-full hover:bg-zinc-800 border border-zinc-800"
          >
            <ArrowLeft size={20} className="text-zinc-400" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase flex items-center gap-2">
              <CreditCard className="text-emerald-500" /> CMS Carteirinha
            </h1>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-xl text-xs font-bold uppercase flex items-center gap-2 shadow-lg transition disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Salvar
          Alteracoes
        </button>
      </header>

      <main className="p-6 max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
          <h3 className="text-sm font-bold text-white uppercase mb-4 flex items-center gap-2">
            <Calendar size={16} className="text-emerald-500" /> Validade do Documento
          </h3>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase mb-2 block">
              Texto de Validade (Verso do Cartao)
            </label>
            <input
              type="text"
              className="w-full bg-black border border-zinc-700 rounded-xl p-4 text-white font-mono text-lg outline-none focus:border-emerald-500 transition"
              value={config.validade}
              onChange={(event) =>
                setConfig({
                  ...config,
                  validade: event.target.value.slice(0, 24),
                })
              }
            />
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
          <div className="flex justify-between items-start mb-6">
            <h3 className="text-sm font-bold text-white uppercase flex items-center gap-2">
              <ImageIcon size={16} className="text-emerald-500" /> Personalizar Fundos
            </h3>
            <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-xl max-w-xs">
              <p className="text-[10px] text-blue-300 leading-relaxed flex gap-2">
                <Info size={14} className="shrink-0 mt-0.5" />
                Por padrao, o sistema usa o arquivo <b>/turmaX.jpeg</b> da pasta public.
                Use os botoes abaixo apenas se quiser substituir por uma imagem diferente.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {TURMAS_LIST.map((turma) => (
              <div
                key={turma}
                className="bg-black/40 p-3 rounded-2xl border border-zinc-800 group relative"
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-black text-white bg-zinc-800 px-2 py-1 rounded">
                    {turma}
                  </span>
                  {config.backgrounds[turma] ? (
                    <CheckCircle2 size={14} className="text-emerald-500" />
                  ) : (
                    <span className="text-[8px] text-zinc-600 uppercase font-bold">
                      Padrao
                    </span>
                  )}
                </div>

                <div className="relative h-32 w-full rounded-xl overflow-hidden bg-zinc-900 border border-zinc-700 mb-3">
                  {config.backgrounds[turma] ? (
                    <Image
                      src={config.backgrounds[turma]}
                      alt={`Background ${turma}`}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-700 text-[10px] font-bold uppercase text-center p-2 opacity-50">
                      Usando
                      <br />
                      Logo Padrao
                    </div>
                  )}

                  {uploadingTurma === turma && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm z-10">
                      <Loader2 className="animate-spin text-emerald-500" />
                    </div>
                  )}
                </div>

                <label
                  className={`block w-full text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold uppercase py-2 rounded-lg cursor-pointer transition ${
                    uploadingTurma ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  Substituir Fundo
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={(event) => {
                      const selectedFile = event.target.files?.[0];
                      if (!selectedFile) return;
                      void handleImageUpload(turma, selectedFile);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
