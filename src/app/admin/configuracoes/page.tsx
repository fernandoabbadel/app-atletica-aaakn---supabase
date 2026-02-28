"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowLeft, Plus, Edit, Trash2, Settings, User, Shield, Wallet,
  Bell, Volume2, MessageSquare, HelpCircle, FileText, CheckCircle,
  Scale, Cookie, Lock, FilePlus, ClipboardList, Siren, Key, Scroll, Smartphone
} from "lucide-react";
import Link from "next/link";
import { useToast } from "../../../context/ToastContext";
import {
  createLegalDoc,
  fetchLegalDocs,
  fetchMenuConfig,
  removeLegalDoc,
  saveMenuConfig,
  updateLegalDoc,
  type LegalDocRecord,
  type MenuConfigSection,
} from "../../../lib/settingsService";

// --- TIPOS ---
type ItemType = "link" | "toggle" | "action";

interface ConfigItem {
  id: string;
  label: string;
  icon: string;
  type: ItemType;
  path?: string;
  active: boolean;
}

interface ConfigSection {
  id: string;
  title: string;
  items: ConfigItem[];
}

interface LegalDoc {
  id: string;
  titulo: string;
  conteudo: string;
  icon: React.ElementType; // Tipagem correta para componentes de ícone
  iconName?: string;
  tipo: "publico" | "interno";
}

// Mapas de Ícones com tipagem correta
const ICON_MAP: Record<string, React.ElementType> = { User, Shield, Wallet, Bell, Volume2, MessageSquare, HelpCircle, FileText, Settings, Smartphone };
const LEGAL_ICON_MAP: Record<string, React.ElementType> = { Lock, Scale, Cookie, ClipboardList, Siren, Key, Scroll, Shield, FileText };

// Dados Iniciais (Fallback)
const INITIAL_SECTIONS: ConfigSection[] = [
  {
    id: "1",
    title: "Sua Conta",
    items: [
      { id: "1", label: "Dados Pessoais", icon: "User", type: "link", path: "/perfil", active: true },
      { id: "2", label: "Carteirinha Digital", icon: "Wallet", type: "link", path: "/carteirinha", active: true },
    ],
  },
  {
    id: "3",
    title: "Central de Ajuda",
    items: [
      { id: "7", label: "Guia do App", icon: "HelpCircle", type: "link", path: "/guia", active: true },
      { id: "8", label: "Termos e Privacidade", icon: "FileText", type: "link", path: "/configuracoes/termos", active: true },
    ],
  },
];

export default function AdminConfiguracoesPage() {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<"app" | "legal">("app");
  
  // Estados do Menu
  const [sections, setSections] = useState<ConfigSection[]>(INITIAL_SECTIONS);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ConfigItem | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string>("");
  const [savingMenu, setSavingMenu] = useState(false);

  // Estados Jurídico
  const [documents, setDocuments] = useState<LegalDoc[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [savingDoc, setSavingDoc] = useState(false);

    // CARREGAR MENU COM LEITURA CONTROLADA
  useEffect(() => {
    let mounted = true;
    const loadMenu = async () => {
      try {
        const menuSections = await fetchMenuConfig();
        if (!mounted || !menuSections) return;

        if (menuSections.length > 0) {
          setSections(menuSections as ConfigSection[]);
        }
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar menu.", "error");
      }
    };

    void loadMenu();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  // CARREGAR DOCS COM LIMITE
  useEffect(() => {
    let mounted = true;
    const loadDocs = async () => {
      try {
        const rows = await fetchLegalDocs({
          includeInternal: true,
          maxResults: 80,
        });

        const docs = rows.map((row) => {
          const data = row as LegalDocRecord;
          const iconName = typeof data.iconName === "string" ? data.iconName : "FileText";
          return {
            ...data,
            id: data.id,
            icon: LEGAL_ICON_MAP[iconName] || FileText,
          } as LegalDoc;
        });

        if (mounted) setDocuments(docs);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar documentos.", "error");
      }
    };

    void loadDocs();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  // Seleção automática do primeiro documento (ajuste do useEffect dependency)
  useEffect(() => {
    if (documents.length > 0 && !selectedDocId) {
        setSelectedDocId(documents[0].id);
    }
  }, [documents, selectedDocId]);

  // --- ACTIONS MENU ---
  const handleSaveMenu = async (newSections: ConfigSection[]) => {
      setSavingMenu(true);
      try {
          await saveMenuConfig(newSections as MenuConfigSection[]);
          addToast("Menu do app atualizado para todos! 📲", "success");
          setSections(newSections);
          setIsModalOpen(false);
      } catch {
          addToast("Erro ao salvar menu.", "error");
      } finally {
          setSavingMenu(false);
      }
  };

  const handleUpdateItem = () => {
      if (!editingItem || !editingSectionId) return;
      const newSections = sections.map(sec => {
          if (sec.id !== editingSectionId) return sec;
          const items = sec.items.some(i => i.id === editingItem.id)
              ? sec.items.map(i => i.id === editingItem.id ? editingItem : i)
              : [...sec.items, editingItem];
          return { ...sec, items };
      });
      handleSaveMenu(newSections);
  };

  const handleDeleteItem = (itemId: string) => {
      if(!confirm("Remover este botão do app?")) return;
      const newSections = sections.map(sec => ({
          ...sec,
          items: sec.items.filter(i => i.id !== itemId)
      }));
      handleSaveMenu(newSections);
  };

  // --- ACTIONS JURIDICO ---
  const handleCreateDoc = async () => {
      const created = await createLegalDoc({
          titulo: "Novo Regulamento",
          conteudo: "Escreva aqui...",
          tipo: "publico",
          iconName: "FileText",
      });
      setDocuments((prev) => {
          const next = [
              ...prev,
              {
                  id: created.id,
                  titulo: "Novo Regulamento",
                  conteudo: "Escreva aqui...",
                  tipo: "publico",
                  iconName: "FileText",
                  icon: FileText,
              } as LegalDoc,
          ];
          next.sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
          return next;
      });
      setSelectedDocId(created.id);
      addToast("Documento criado.", "success");
  };

  const handleSaveDoc = async () => {
      const docData = documents.find(d => d.id === selectedDocId);
      if(!docData) return;
      setSavingDoc(true);
      try {
          await updateLegalDoc(selectedDocId, {
              titulo: docData.titulo,
              conteudo: docData.conteudo,
          });
          addToast("Documento salvo e publicado! 📜", "success");
      } catch { addToast("Erro ao salvar.", "error"); }
      finally { setSavingDoc(false); }
  };

  const handleDeleteDoc = async (id: string) => {
      if(!confirm("Apagar documento?")) return;
      try {
          await removeLegalDoc(id);
          setDocuments((prev) => prev.filter((docItem) => docItem.id !== id));
          if (selectedDocId === id) setSelectedDocId("");
          addToast("Documento removido.", "info");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao remover documento.", "error");
      }
  };

  const currentDoc = documents.find(d => d.id === selectedDocId);

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-20 font-sans">
      <header className="p-6 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="bg-zinc-900 p-3 rounded-full hover:bg-zinc-800 border border-zinc-800">
            <ArrowLeft size={20} className="text-zinc-400" />
          </Link>
          <h1 className="text-xl font-black uppercase flex items-center gap-2">
            <Settings className="text-emerald-500" /> Configs & Legal
          </h1>
        </div>
      </header>

      <div className="px-6 pt-6">
        <div className="flex border-b border-zinc-800 gap-6">
          <button onClick={() => setActiveTab("app")} className={`pb-4 text-xs font-bold uppercase border-b-2 flex items-center gap-2 transition ${activeTab === "app" ? "text-emerald-500 border-emerald-500" : "text-zinc-500 border-transparent"}`}>
            <Smartphone size={16} /> Menu do App
          </button>
          <button onClick={() => setActiveTab("legal")} className={`pb-4 text-xs font-bold uppercase border-b-2 flex items-center gap-2 transition ${activeTab === "legal" ? "text-emerald-500 border-emerald-500" : "text-zinc-500 border-transparent"}`}>
            <Scale size={16} /> Jurídico
          </button>
        </div>
      </div>

      <main className="p-6 max-w-6xl mx-auto">
        {activeTab === "app" && (
          <div className="space-y-8 max-w-3xl mx-auto">
            {sections.map((section) => (
              <div key={section.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
                <div className="p-4 bg-black/20 border-b border-zinc-800 flex justify-between items-center">
                  <h3 className="text-sm font-black uppercase text-zinc-400 tracking-wider pl-2">{section.title}</h3>
                  <button onClick={() => { setEditingSectionId(section.id); setEditingItem({ id: Date.now().toString(), label: "Novo Botão", icon: "Settings", type: "link", path: "/", active: true }); setIsModalOpen(true); }} className="text-[10px] bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg font-bold uppercase flex items-center gap-1 transition">
                    <Plus size={12} /> Novo Botão
                  </button>
                </div>
                <div className="divide-y divide-zinc-800">
                  {section.items.map((item) => {
                      const Icon = ICON_MAP[item.icon] || Settings;
                      return (
                        <div key={item.id} className="p-4 flex items-center justify-between group hover:bg-zinc-800/50 transition">
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border border-zinc-700 ${item.active ? "bg-black text-emerald-500" : "bg-zinc-800 text-zinc-600"}`}>
                              <Icon size={20} />
                            </div>
                            <div>
                              <h4 className="font-bold text-sm text-white flex items-center gap-2">{item.label} {!item.active && <span className="text-[9px] bg-red-500/20 text-red-500 px-1.5 rounded uppercase">Inativo</span>}</h4>
                              <p className="text-[10px] text-zinc-500 font-mono">{item.path}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                              <button onClick={() => { setEditingSectionId(section.id); setEditingItem(item); setIsModalOpen(true); }} className="p-2 text-zinc-400 hover:text-white bg-zinc-800 rounded-lg"><Edit size={16} /></button>
                              <button onClick={() => handleDeleteItem(item.id)} className="p-2 text-zinc-400 hover:text-red-500 bg-zinc-800 rounded-lg"><Trash2 size={16} /></button>
                          </div>
                        </div>
                      );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "legal" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[75vh]">
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 overflow-y-auto flex flex-col">
              <div className="mb-4 px-2 flex justify-between items-center">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Biblioteca</h3>
                <button onClick={handleCreateDoc} className="text-emerald-500 bg-emerald-500/10 p-1.5 rounded-lg"><Plus size={14} /></button>
              </div>
              <div className="space-y-2 flex-1">
                {documents.map((docx) => {
                  const DocIcon = docx.icon;
                  return (
                    <button key={docx.id} onClick={() => setSelectedDocId(docx.id)} className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition relative group ${selectedDocId === docx.id ? "bg-zinc-800 text-white border border-emerald-500/30" : "bg-black/40 text-zinc-400 hover:bg-zinc-800"}`}>
                      <DocIcon size={16} className={docx.tipo === "interno" ? "text-yellow-500" : "text-emerald-500"} />
                      <div className="flex-1 min-w-0"><span className="text-xs font-bold uppercase block truncate">{docx.titulo}</span></div>
                      <div onClick={(e) => { e.stopPropagation(); handleDeleteDoc(docx.id); }} className="absolute right-2 opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 text-red-500 rounded"><Trash2 size={12} /></div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-3 bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col overflow-hidden">
              {currentDoc ? (
                <>
                  <div className="p-4 bg-black/20 border-b border-zinc-800 flex justify-between items-center">
                    <input type="text" className="bg-transparent text-lg font-black text-white uppercase outline-none w-full placeholder-zinc-600" value={currentDoc.titulo} onChange={(e) => {
                        setDocuments(docs => docs.map(d => d.id === selectedDocId ? { ...d, titulo: e.target.value } : d));
                    }} placeholder="TÍTULO DO DOCUMENTO" />
                    <button onClick={handleSaveDoc} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 shadow-lg transition">
                      <CheckCircle size={14} /> {savingDoc ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                  <textarea className="flex-1 w-full bg-[#09090b] text-zinc-300 p-6 font-mono text-xs outline-none resize-none leading-relaxed custom-scrollbar" value={currentDoc.conteudo} onChange={(e) => {
                      setDocuments(docs => docs.map(d => d.id === selectedDocId ? { ...d, conteudo: e.target.value } : d));
                  }} placeholder="Conteúdo jurídico aqui..." />
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-4"><FilePlus size={48} className="opacity-20" /><p className="text-sm font-bold uppercase">Selecione um documento</p></div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* MODAL EDITOR DE BOTÃO */}
      {isModalOpen && editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 w-full max-w-lg rounded-3xl border border-zinc-800 p-6 shadow-2xl animate-in zoom-in-95">
            <h2 className="font-bold text-white text-xl mb-4">Editar Botão do App</h2>
            <div className="space-y-4">
              <div><label className="text-[10px] font-bold text-zinc-500 uppercase">Nome do Botão</label><input type="text" className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-white text-sm outline-none focus:border-emerald-500" value={editingItem.label} onChange={(e) => setEditingItem({ ...editingItem, label: e.target.value })} /></div>
              <div><label className="text-[10px] font-bold text-zinc-500 uppercase">Rota / Link</label><input type="text" className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-emerald-500 font-mono text-sm outline-none focus:border-emerald-500" value={editingItem.path || ""} onChange={(e) => setEditingItem({ ...editingItem, path: e.target.value })} /></div>
              <div className="flex items-center gap-2"><label className="text-white text-xs font-bold cursor-pointer select-none"><input type="checkbox" checked={editingItem.active} onChange={(e) => setEditingItem({ ...editingItem, active: e.target.checked })} className="mr-2" /> Visível no App</label></div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-lg text-zinc-400 font-bold text-xs bg-zinc-800">Cancelar</button>
              <button 
                onClick={handleUpdateItem} 
                disabled={savingMenu}
                className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-bold text-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {savingMenu ? "Salvando..." : "Salvar Alterações"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



