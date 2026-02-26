"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  QrCode, Ticket, Edit, Calendar, Store,
  Camera, LogOut, Loader2, X, FileText, ChevronRight
} from "lucide-react";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Html5Qrcode } from "html5-qrcode";
import { useToast } from "../../../context/ToastContext";
import {
  createPartnerScan,
  fetchPartnerById,
  fetchPartnerScans,
  uploadPartnerImageToStorage,
  updatePartnerProfile,
  type PartnerRecord,
} from "../../../lib/partnersService";
import { logActivity } from "../../../lib/logger";

// --- TIPAGEM ---
interface Cupom {
    titulo: string;
    valor: string;
}

interface EmpresaData {
    id: string;
    nome: string;
    imgLogo?: string;
    imgCapa?: string;
    totalScans?: number;
    cupons?: Cupom[];
    createdAt?: unknown;
    descricao?: string;
    insta?: string;
    whats?: string;
}

interface ScanData {
    id: string;
    empresaId: string;
    empresa: string;
    usuario: string;
    userId: string;
    cupom: string;
    valorEconomizado: string;
    data: string;
    hora: string;
    timestamp: unknown;
}

interface EditFormState {
    nome?: string;
    descricao?: string;
    insta?: string;
    whats?: string;
    imgLogo?: string;
    imgCapa?: string;
}

const formatPartnerCreatedAt = (raw: unknown): string => {
  if (!raw) return new Date().toLocaleDateString();
  if (raw instanceof Date) return raw.toLocaleDateString();
  if (typeof raw === "string" || typeof raw === "number") {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
    return new Date().toLocaleDateString();
  }

  const obj = raw as { toDate?: () => Date };
  if (typeof obj.toDate === "function") {
    const date = obj.toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date.toLocaleDateString();
    }
  }

  return new Date().toLocaleDateString();
};

export default function EmpresaDashboard() {
  const { addToast } = useToast();
  const router = useRouter();
  const params = useParams(); 
  const empresaId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [partner, setPartner] = useState<EmpresaData | null>(null);
  const [history, setHistory] = useState<ScanData[]>([]);
  const [scanning, setScanning] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  
  // Edição
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState>({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingProfileImageField, setUploadingProfileImageField] =
    useState<"imgLogo" | "imgCapa" | null>(null);
  
  // Refs
  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingScanRef = useRef(false);

  // --- CARREGAR DADOS DO SUPABASE ---
  useEffect(() => {
    const fetchCompanyData = async () => {
        if (!empresaId) return;
        try {
            const [partnerData, partnerScans] = await Promise.all([
              fetchPartnerById(empresaId, { forceRefresh: false }),
              fetchPartnerScans({
                partnerId: empresaId,
                maxResults: 120,
                forceRefresh: false,
              }),
            ]);

            if (partnerData) {
                const data = partnerData as EmpresaData;
                setPartner(data);
                setEditForm(data); // Prepara form
            } else {
                addToast("Empresa não encontrada.", "error");
                router.push("/empresa");
            }
            setHistory((partnerScans as ScanData[]).slice(0, 10));
        } catch (error: unknown) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };
    fetchCompanyData();
  }, [empresaId, addToast, router]);

  // --- AÇÕES ---

  const registerScanFromPayload = useCallback(async (rawPayload: string) => {
      if (!partner) return;

      let scanUserId = "";
      let scanUsuario = "";
      let scanCupom = partner.cupons?.[0]?.titulo || "Desconto";
      let scanValor = partner.cupons?.[0]?.valor || "R$ 0,00";

      try {
          const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
          scanUserId = String(parsed.userId || parsed.uid || "").trim();
          scanUsuario = String(parsed.usuario || parsed.userName || "").trim();
          scanCupom = String(parsed.cupom || scanCupom).trim() || scanCupom;
          scanValor = String(parsed.valorEconomizado || scanValor).trim() || scanValor;
      } catch {
          scanUserId = rawPayload.trim();
      }

      if (!scanUserId) {
          addToast("QR invalido: userId ausente.", "error");
          return;
      }
      if (!scanUsuario) {
          scanUsuario = `Aluno ${scanUserId.slice(0, 8)}`;
      }

      setScanning(true);
      try {
          const scanResult = await createPartnerScan({
              partnerId: empresaId,
              partnerName: partner.nome,
              usuario: scanUsuario,
              userId: scanUserId,
              cupom: scanCupom,
              valorEconomizado: scanValor,
              data: new Date().toLocaleDateString("pt-BR"),
              hora: new Date().toLocaleTimeString("pt-BR"),
          });

          const nextTotal =
            scanResult.totalScans > 0
              ? scanResult.totalScans
              : (partner.totalScans || 0) + 1;
          setHistory((prev) => [scanResult.scan as ScanData, ...prev].slice(0, 10));
          setPartner((prev) => prev ? ({ ...prev, totalScans: nextTotal }) : null);
          addToast("Cupom validado com sucesso.", "success");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao registrar scan.", "error");
      } finally {
          setScanning(false);
      }
  }, [addToast, empresaId, partner]);

  const handleManualScan = () => {
      const rawPayload = window.prompt(
          "Cole o payload do QR (JSON com userId/usuario/cupom/valorEconomizado, ou apenas userId):"
      );
      if (!rawPayload?.trim()) return;
      void registerScanFromPayload(rawPayload.trim());
  };

  const closeScanner = useCallback(async () => {
      if (scannerRef.current?.isScanning) {
          try {
              await scannerRef.current.stop();
          } catch {
              // ignora stop race condition
          }
      }

      if (scannerRef.current) {
          scannerRef.current.clear();
          scannerRef.current = null;
      }

      setShowScanner(false);
  }, []);

  const handleDecodedQr = useCallback(async (decodedText: string) => {
      if (processingScanRef.current) return;
      processingScanRef.current = true;
      await closeScanner();
      await registerScanFromPayload(decodedText);
      processingScanRef.current = false;
  }, [closeScanner, registerScanFromPayload]);

  useEffect(() => {
      if (!showScanner || scannerRef.current) return;

      const startScanner = async () => {
          try {
              const scanner = new Html5Qrcode("partner-reader");
              scannerRef.current = scanner;
              await scanner.start(
                  { facingMode: "environment" },
                  { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1 },
                  (decodedText) => {
                      void handleDecodedQr(decodedText);
                  },
                  () => {}
              );
          } catch (error: unknown) {
              console.error(error);
              addToast("Nao foi possivel abrir a camera.", "error");
              setShowScanner(false);
          }
      };

      void startScanner();

      return () => {
          if (scannerRef.current?.isScanning) {
              void scannerRef.current
                  .stop()
                  .then(() => {
                      scannerRef.current?.clear();
                      scannerRef.current = null;
                  })
                  .catch(() => {});
          } else if (scannerRef.current) {
              scannerRef.current.clear();
              scannerRef.current = null;
          }
          processingScanRef.current = false;
      };
  }, [addToast, handleDecodedQr, showScanner]);

  const handleSaveProfile = async () => {
      if (!partner) return;
      setSavingProfile(true);
      try {
          await updatePartnerProfile({
            partnerId: empresaId,
            data: editForm as Partial<PartnerRecord>,
          });
          setPartner(prev => prev ? ({...prev, ...editForm}) : null);
          setShowEditModal(false);
          addToast("Aí sim! O Tubarão aprovou! 🦈 Perfil atualizado.", "success");
          await logActivity(
            empresaId,
            partner.nome || "Parceiro",
            "UPDATE",
            "parceiros",
            { tipo: "perfil", campos: Object.keys(editForm) }
          );
      } catch {
          addToast("Deu ruim no plantão! 🚨 Erro ao salvar.", "error");
      } finally {
          setSavingProfile(false);
      }
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: "imgLogo" | "imgCapa"
  ) => {
      const file = e.target.files?.[0];
      if (!file || !partner) return;

      setUploadingProfileImageField(field);
      try {
          const imageUrl = await uploadPartnerImageToStorage({
            file,
            kind: field === "imgCapa" ? "capa" : "logo",
            partnerId: empresaId,
          });
          setEditForm((prev) => ({ ...prev, [field]: imageUrl }));
          addToast("Aí sim! O Tubarão aprovou! 🦈 Imagem enviada.", "success");
          await logActivity(
            empresaId,
            partner.nome || "Parceiro",
            "UPDATE",
            "parceiros_uploads",
            { campo: field, origem: "empresa_dashboard" }
          );
      } catch (error: unknown) {
          console.error(error);
          addToast("Deu ruim no plantão! 🚨 Imagem inválida ou upload falhou.", "error");
      } finally {
          setUploadingProfileImageField(null);
          e.target.value = "";
      }
  };

  if (loading) return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500" /></div>;
  if (!partner) return null;

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20 selection:bg-emerald-500">
      
      {/* HEADER ESPECÍFICO DA EMPRESA */}
      <header className="p-6 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center sticky top-0 z-30 shadow-md">
          <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-black border border-zinc-700 flex items-center justify-center overflow-hidden relative">
                  {/* 🦈 CORREÇÃO: Image Otimizado */}
                  {partner.imgLogo ? <Image src={partner.imgLogo} alt={partner.nome} fill className="object-cover" unoptimized/> : <Store size={20} className="text-zinc-500"/>}
              </div>
              <div>
                  <h2 className="text-lg font-black uppercase text-white leading-none">{partner.nome}</h2>
                  <p className="text-[10px] text-emerald-500 font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Painel de Controle</p>
              </div>
          </div>
          <button onClick={() => router.push("/empresa")} className="bg-black p-2 rounded-full text-zinc-500 hover:text-red-500 transition border border-zinc-800"><LogOut size={18}/></button>
      </header>

      <main className="p-6 space-y-8 max-w-6xl mx-auto animate-in fade-in duration-500">
          
          <div className="flex justify-between items-center bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 backdrop-blur-sm">
              <div>
                  <p className="text-xs text-zinc-400 font-bold uppercase">Meus Dados</p>
                  <p className="text-white font-bold text-sm">Mantenha sua página sempre atualizada.</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/empresa/${empresaId}/historico`}
                  className="p-2 bg-zinc-800 text-zinc-300 rounded-lg hover:bg-zinc-700 flex items-center gap-2 text-xs font-bold uppercase"
                >
                  <FileText size={14} /> Historico
                </Link>
                <button
                  onClick={() => setShowEditModal(true)}
                  className="p-2 bg-zinc-800 text-zinc-300 rounded-lg hover:bg-zinc-700 flex items-center gap-2 text-xs font-bold uppercase"
                >
                  <Edit size={14} /> Editar
                </button>
              </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* ESQUERDA: AÇÕES */}
            <div className="space-y-6 lg:col-span-1">
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 shadow-lg">
                        <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1"><Calendar size={10}/> Cliente Desde</p>
                        <h3 className="text-xs font-black text-white">{formatPartnerCreatedAt(partner.createdAt)}</h3>
                    </div>
                    <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 shadow-lg">
                        <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1"><Ticket size={10}/> Total Scans</p>
                        <h3 className="text-xl font-black text-emerald-500">{partner.totalScans || 0}</h3>
                    </div>
                </div>

                <div onClick={() => setShowScanner(true)} className="bg-gradient-to-b from-emerald-900/20 to-zinc-900 border border-emerald-500/30 rounded-3xl p-8 text-center cursor-pointer active:scale-95 transition shadow-lg relative overflow-hidden group">
                    <div className="absolute inset-0 bg-emerald-500/10 blur-xl opacity-0 group-hover:opacity-100 transition duration-500"></div>
                    <div className={`w-32 h-32 mx-auto rounded-full bg-black border-4 flex items-center justify-center mb-4 transition duration-500 relative z-10 ${scanning ? 'border-emerald-500 animate-pulse shadow-[0_0_40px_rgba(16,185,129,0.4)]' : 'border-zinc-700 group-hover:border-emerald-500'}`}>
                        <Camera size={40} className={scanning ? 'text-emerald-500' : 'text-zinc-500 group-hover:text-emerald-500'}/>
                    </div>
                    <h3 className="text-xl font-black uppercase mb-1 relative z-10 text-white">{scanning ? "Lendo QR..." : "Ler QR Code"}</h3>
                    <p className="text-xs text-zinc-400 relative z-10">Validar desconto do aluno</p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleManualScan();
                      }}
                      className="relative z-10 mt-4 text-[10px] uppercase font-bold text-emerald-400 hover:text-emerald-300"
                    >
                      Digitar codigo manualmente
                    </button>
                </div>
            </div>

            {/* DIREITA: HISTÓRICO REAL */}
            <div className="lg:col-span-2">
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-xl h-full flex flex-col">
                    <div className="p-6 border-b border-zinc-800 bg-black/20">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-bold text-white flex items-center gap-2"><QrCode size={18} className="text-emerald-500"/> Ultimos scans</h3>
                          <Link
                            href={`/empresa/${empresaId}/historico`}
                            className="text-[10px] uppercase font-black text-emerald-400 flex items-center gap-1 hover:text-emerald-300"
                          >
                            Ver completo <ChevronRight size={12} />
                          </Link>
                        </div>
                    </div>
                    <div className="overflow-x-auto flex-1 custom-scrollbar">
                        <table className="w-full text-left whitespace-nowrap">
                            <thead className="bg-black/40 border-b border-zinc-800 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                                <tr><th className="p-4">Data</th><th className="p-4">Aluno</th><th className="p-4">Cupom</th><th className="p-4 text-right">Valor</th></tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/50 text-sm text-zinc-300">
                                {history.map((log) => (
                                    <tr key={log.id} className="hover:bg-zinc-800/30 transition">
                                        <td className="p-4"><div>{log.data}</div><div className="text-[10px] text-zinc-500">{log.hora}</div></td>
                                        <td className="p-4"><div className="text-white font-medium">{log.usuario}</div><span className="text-[10px] text-zinc-500">{log.userId}</span></td>
                                        <td className="p-4 flex items-center gap-2"><Ticket size={14} className="text-emerald-500"/> {log.cupom}</td>
                                        <td className="p-4 text-right font-mono text-emerald-400 font-bold">{log.valorEconomizado}</td>
                                    </tr>
                                ))}
                                {history.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-zinc-500 text-xs">Nenhum scan registrado ainda.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

          </div>
      </main>

      {/* MODAL EDITAR (SIMPLIFICADO PARA O CONTEXTO) */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 w-full max-w-2xl rounded-2xl border border-zinc-800 p-6 shadow-2xl relative">
                <button onClick={() => setShowEditModal(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><X size={20}/></button>
                <h3 className="font-bold text-white text-lg mb-4">Editar Informações</h3>
                
                <div className="space-y-4">
                    <div><label className="text-[10px] text-zinc-500 uppercase font-bold">Descrição</label><textarea className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-white text-sm" rows={3} value={editForm.descricao || ""} onChange={e => setEditForm({...editForm, descricao: e.target.value})}/></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-[10px] text-zinc-500 uppercase font-bold">Instagram</label><input type="text" className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-white text-sm" value={editForm.insta || ""} onChange={e => setEditForm({...editForm, insta: e.target.value})}/></div>
                        <div><label className="text-[10px] text-zinc-500 uppercase font-bold">WhatsApp</label><input type="text" className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-white text-sm" value={editForm.whats || ""} onChange={e => setEditForm({...editForm, whats: e.target.value})}/></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <button
                          onClick={() => logoInputRef.current?.click()}
                          disabled={uploadingProfileImageField !== null}
                          className="bg-zinc-800 p-3 rounded-lg text-xs text-zinc-300 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                        >
                          {uploadingProfileImageField === "imgLogo" ? <Loader2 size={14} className="animate-spin" /> : null}
                          {uploadingProfileImageField === "imgLogo" ? "Enviando logo..." : "Alterar Logo"}
                        </button>
                        <button
                          onClick={() => coverInputRef.current?.click()}
                          disabled={uploadingProfileImageField !== null}
                          className="bg-zinc-800 p-3 rounded-lg text-xs text-zinc-300 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                        >
                          {uploadingProfileImageField === "imgCapa" ? <Loader2 size={14} className="animate-spin" /> : null}
                          {uploadingProfileImageField === "imgCapa" ? "Enviando capa..." : "Alterar Capa"}
                        </button>
                        <input type="file" hidden ref={logoInputRef} onChange={e => handleFileChange(e, 'imgLogo')}/>
                        <input type="file" hidden ref={coverInputRef} onChange={e => handleFileChange(e, 'imgCapa')}/>
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <button onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-lg text-zinc-400 hover:text-white text-xs font-bold">Cancelar</button>
                    <button
                      onClick={handleSaveProfile}
                      disabled={savingProfile || uploadingProfileImageField !== null}
                      className="px-6 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
                    >
                      {savingProfile ? <Loader2 size={14} className="animate-spin" /> : null}
                      {savingProfile ? "Salvando..." : "Salvar Alterações"}
                    </button>
                </div>
            </div>
        </div>
      )}

      {showScanner && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-in fade-in duration-300">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-green-400 to-emerald-500 z-50 animate-pulse" />
          <div className="flex-1 relative flex items-center justify-center bg-black">
            <div id="partner-reader" className="w-full h-full max-w-lg overflow-hidden" />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-64 h-64 border-4 border-emerald-500/50 rounded-3xl relative" />
            </div>
            <button
              onClick={() => {
                void closeScanner();
              }}
              className="absolute top-6 right-6 bg-black/50 text-white p-3 rounded-full backdrop-blur-md z-50 border border-white/10"
            >
              <X size={24} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
