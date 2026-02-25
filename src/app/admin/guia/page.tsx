"use client";

import React, { useCallback, useMemo, useState, useEffect } from "react";
import {
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  BookOpen,
  Bus,
  Map,
  Phone,
  Image as ImageIcon,
  ExternalLink,
  AlertTriangle,
  Loader2,
  Database,
  RefreshCw,
  GripVertical,
  Users,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";

import { useToast } from "../../../context/ToastContext";
import {
  deleteGuideItem,
  fetchGuideData,
  type GuideCategory,
  seedGuideDefaults,
  upsertGuideItem,
  uploadGuidePhoto,
} from "../../../lib/guiaService";

type GuiaItem = {
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

type GuiaMap = Record<GuideCategory, GuiaItem[]>;
type LoadedMap = Record<GuideCategory, boolean>;

const INITIAL_GUIA_DATA: Array<Record<string, unknown>> = [
  { categoria: "academico", titulo: "Portal do Aluno (EVA)", url: "https://eva.unitau.br", ordem: 1 },
  { categoria: "academico", titulo: "Calendario Academico 2026", url: "https://unitau.br/calendario", ordem: 2 },
  { categoria: "academico", titulo: "Cardapio do RU", url: "https://unitau.br/ru", ordem: 3 },

  { categoria: "transporte", nome: "Circular (Intercampi)", horario: "07:10, 12:30 | 11:50, 17:50", detalhe: "Saida Terminal <-> Campus", ordem: 1 },

  { categoria: "turismo", nome: "Praia Martim de Sa", descricao: "O point da galera", foto: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80", ordem: 1 },
  { categoria: "turismo", nome: "Pedra da Freira", descricao: "Por do sol top", foto: "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=800&q=80", ordem: 2 },

  { categoria: "emergencia", nome: "SAMU", numero: "192", cor: "red", ordem: 1 },
  { categoria: "emergencia", nome: "Policia", numero: "190", cor: "red", ordem: 2 },

  { categoria: "grupos", titulo: "Grupo Oficial dos Calouros", url: "https://chat.whatsapp.com/", ordem: 1 },
  { categoria: "grupos", titulo: "Plantao de Duvidas", url: "https://chat.whatsapp.com/", ordem: 2 },
];

const CATEGORIES: Array<{ key: GuideCategory; label: string; icon: React.ElementType }> = [
  { key: "academico", label: "Academico", icon: BookOpen },
  { key: "transporte", label: "Transporte", icon: Bus },
  { key: "turismo", label: "Turismo", icon: Map },
  { key: "emergencia", label: "Emergencia", icon: Phone },
  { key: "grupos", label: "Grupos", icon: Users },
];

const EMPTY_DATA: GuiaMap = {
  academico: [],
  transporte: [],
  turismo: [],
  emergencia: [],
  grupos: [],
};

const EMPTY_LOADED: LoadedMap = {
  academico: false,
  transporte: false,
  turismo: false,
  emergencia: false,
  grupos: false,
};

const sortItems = (rows: GuiaItem[]): GuiaItem[] =>
  [...rows].sort((left, right) => {
    const leftOrder = typeof left.ordem === "number" ? left.ordem : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.ordem === "number" ? right.ordem : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    const leftLabel = left.titulo || left.nome || "";
    const rightLabel = right.titulo || right.nome || "";
    return leftLabel.localeCompare(rightLabel, "pt-BR");
  });

const stripId = (item: GuiaItem): Record<string, unknown> => {
  const clone: Record<string, unknown> = { ...item };
  delete clone.id;
  return clone;
};

export default function AdminGuiaPage() {
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<GuideCategory>("academico");
  const [data, setData] = useState<GuiaMap>(EMPTY_DATA);
  const [loadedTabs, setLoadedTabs] = useState<LoadedMap>(EMPTY_LOADED);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<GuiaItem> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isReordering, setIsReordering] = useState(false);

  const [previewImage, setPreviewImage] = useState<string>("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  const loadGuideData = useCallback(
    async (tab: GuideCategory, forceRefresh = true) => {
      setLoading(true);
      try {
        const rows = await fetchGuideData({
          category: tab,
          maxResults: 240,
          forceRefresh,
        });

        const tabRows = rows
          .map((raw) => raw as unknown as GuiaItem)
          .filter((item) => item.categoria === tab);

        setData((current) => ({ ...current, [tab]: sortItems(tabRows) }));
        setLoadedTabs((current) => ({ ...current, [tab]: true }));
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar o guia.", "error");
      } finally {
        setLoading(false);
      }
    },
    [addToast]
  );

  useEffect(() => {
    if (loadedTabs[activeTab]) return;
    void loadGuideData(activeTab, true);
  }, [activeTab, loadedTabs, loadGuideData]);

  const currentRows = useMemo(() => data[activeTab], [data, activeTab]);

  const persistTabOrder = useCallback(
    async (tab: GuideCategory, rows: GuiaItem[]) => {
      setIsReordering(true);
      try {
        const payloads = rows.map((row, index) => {
          const next = { ...row, ordem: index + 1 };
          return upsertGuideItem({ itemId: row.id, data: stripId(next) });
        });
        await Promise.all(payloads);

        setData((current) => ({
          ...current,
          [tab]: rows.map((row, index) => ({ ...row, ordem: index + 1 })),
        }));
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao salvar a ordem.", "error");
      } finally {
        setIsReordering(false);
      }
    },
    [addToast]
  );

  const handleSeedGuia = async () => {
    if (process.env.NODE_ENV === "production") {
      addToast("Restauracao bloqueada em producao.", "error");
      return;
    }

    if (!confirm("Confirmar restauracao do guia padrao?")) return;

    setIsSaving(true);
    try {
      await seedGuideDefaults(INITIAL_GUIA_DATA);
      addToast("Guia restaurado com sucesso!", "success");
      setLoadedTabs(EMPTY_LOADED);
      await loadGuideData(activeTab, true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao restaurar dados.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreate = () => {
    const nextOrder = currentRows.length + 1;
    const base: Partial<GuiaItem> = { categoria: activeTab, ordem: nextOrder };

    if (activeTab === "academico" || activeTab === "grupos") {
      setEditingItem({ ...base, titulo: "", url: "" });
    }
    if (activeTab === "transporte") {
      setEditingItem({ ...base, nome: "", horario: "", detalhe: "" });
    }
    if (activeTab === "turismo") {
      setEditingItem({ ...base, nome: "", descricao: "", foto: "" });
      setPreviewImage("");
      setImageFile(null);
    }
    if (activeTab === "emergencia") {
      setEditingItem({ ...base, nome: "", numero: "", cor: "red" });
    }

    setIsModalOpen(true);
  };

  const handleEdit = (item: GuiaItem) => {
    setEditingItem({ ...item });
    if (item.categoria === "turismo") {
      setPreviewImage(item.foto || "");
      setImageFile(null);
    }
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remover este item do guia permanentemente?")) return;

    try {
      await deleteGuideItem(id);
      addToast("Item removido.", "info");
      await loadGuideData(activeTab, true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao excluir.", "error");
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setPreviewImage(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!editingItem) return;
    setIsSaving(true);

    try {
      let finalPhoto = editingItem.foto;
      if (activeTab === "turismo" && imageFile) {
        finalPhoto = await uploadGuidePhoto(imageFile);
      }

      const normalizedOrder =
        typeof editingItem.ordem === "number" && Number.isFinite(editingItem.ordem)
          ? editingItem.ordem
          : currentRows.length + 1;

      const dataToSave: GuiaItem = {
        ...(editingItem as GuiaItem),
        categoria: activeTab,
        foto: finalPhoto,
        ordem: Math.max(1, Math.round(normalizedOrder)),
      };

      if (editingItem.id) {
        await upsertGuideItem({ itemId: editingItem.id, data: stripId(dataToSave) });
        addToast("Item atualizado!", "success");
      } else {
        await upsertGuideItem({ data: stripId(dataToSave) });
        addToast("Item criado!", "success");
      }

      setIsModalOpen(false);
      await loadGuideData(activeTab, true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDropOnItem = async (targetId: string) => {
    if (!draggingItemId || draggingItemId === targetId) return;

    const rows = [...currentRows];
    const fromIndex = rows.findIndex((row) => row.id === draggingItemId);
    const toIndex = rows.findIndex((row) => row.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    const [moved] = rows.splice(fromIndex, 1);
    rows.splice(toIndex, 0, moved);

    setData((current) => ({ ...current, [activeTab]: rows }));
    setDraggingItemId(null);
    await persistTabOrder(activeTab, rows);
  };

  const renderCardContent = (item: GuiaItem) => {
    if (activeTab === "academico" || activeTab === "grupos") {
      return (
        <div className="flex justify-between items-center w-full gap-3">
          <div>
            <h4 className="font-bold text-white">{item.titulo}</h4>
            <p className="text-xs text-zinc-500 truncate max-w-[220px]">{item.url}</p>
          </div>
          <ExternalLink size={16} className="text-emerald-500" />
        </div>
      );
    }

    if (activeTab === "transporte") {
      return (
        <div className="w-full">
          <div className="flex justify-between mb-1 gap-3">
            <h4 className="font-bold text-white">{item.nome}</h4>
            <span className="text-xs font-mono text-emerald-400 bg-emerald-900/30 px-2 py-0.5 rounded">
              {item.horario}
            </span>
          </div>
          <p className="text-xs text-zinc-500">{item.detalhe}</p>
        </div>
      );
    }

    if (activeTab === "turismo") {
      return (
        <div className="flex gap-4 w-full">
          <div className="w-16 h-16 bg-black rounded-lg overflow-hidden shrink-0 border border-zinc-700 relative">
            {item.foto ? (
              <Image src={item.foto} alt={item.nome || "Turismo"} fill unoptimized className="object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-600">
                <ImageIcon size={20} />
              </div>
            )}
          </div>
          <div>
            <h4 className="font-bold text-white">{item.nome}</h4>
            <p className="text-xs text-zinc-500 line-clamp-2">{item.descricao}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-between items-center w-full">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${item.cor === "red" ? "bg-red-500/20 text-red-500" : "bg-zinc-800 text-zinc-400"}`}>
            <AlertTriangle size={18} />
          </div>
          <h4 className="font-bold text-white">{item.nome}</h4>
        </div>
        <span className="text-xl font-black text-white">{item.numero}</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-20 font-sans selection:bg-emerald-500">
      <header className="p-6 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="bg-zinc-900 p-3 rounded-full hover:bg-zinc-800 border border-zinc-800">
            <ArrowLeft size={20} className="text-zinc-400" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase flex items-center gap-2">
              <BookOpen className="text-emerald-500" /> Editor do Guia
            </h1>
            <p className="text-[10px] text-zinc-500 uppercase font-bold">Com ordenacao por arrastar e soltar</p>
          </div>
        </div>
        <button
          onClick={handleCreate}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 shadow-lg hover:scale-105 transition"
        >
          <Plus size={16} /> Adicionar
        </button>
      </header>

      <div className="px-6 pt-6 overflow-x-auto">
        <div className="flex border-b border-zinc-800 gap-4 min-w-max">
          {CATEGORIES.map((category) => {
            const Icon = category.icon;
            const isActive = activeTab === category.key;
            return (
              <button
                key={category.key}
                onClick={() => setActiveTab(category.key)}
                className={`pb-4 text-xs font-bold uppercase border-b-2 flex items-center gap-2 transition ${
                  isActive ? "text-emerald-500 border-emerald-500" : "text-zinc-500 border-transparent hover:text-zinc-300"
                }`}
              >
                <Icon size={16} /> {category.label}
              </button>
            );
          })}
        </div>
      </div>

      <main className="p-6 max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-emerald-500" size={40} />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mb-4">
              <p className="text-xs text-zinc-500 uppercase font-bold inline-flex items-center gap-2">
                <GripVertical size={14} /> Arraste os cards para ordenar
              </p>
              {isReordering ? (
                <span className="text-xs text-emerald-400 uppercase font-bold inline-flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" /> Salvando ordem
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentRows.map((item) => (
                <div
                  key={item.id}
                  draggable={!isReordering}
                  onDragStart={() => setDraggingItemId(item.id)}
                  onDragEnd={() => setDraggingItemId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    void handleDropOnItem(item.id);
                  }}
                  className={`bg-zinc-900 border p-4 rounded-2xl flex justify-between items-center gap-4 transition group ${
                    draggingItemId === item.id
                      ? "border-emerald-500/60 opacity-70"
                      : "border-zinc-800 hover:border-emerald-500/30"
                  }`}
                >
                  <div className="flex items-center gap-3 w-full min-w-0">
                    <div className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-500 cursor-grab active:cursor-grabbing">
                      <GripVertical size={14} />
                    </div>
                    {renderCardContent(item)}
                  </div>

                  <div className="flex flex-col gap-2 shrink-0 border-l border-zinc-800 pl-3 ml-2">
                    <button onClick={() => handleEdit(item)} className="text-zinc-500 hover:text-white transition">
                      <Edit size={16} />
                    </button>
                    <button onClick={() => void handleDelete(item.id)} className="text-zinc-500 hover:text-red-500 transition">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {currentRows.length === 0 && (
              <div className="text-center py-10 flex flex-col items-center gap-6">
                <p className="text-zinc-600 text-sm font-bold uppercase">Nenhum item nesta secao.</p>
                <div className="w-full max-w-md bg-zinc-900 border border-dashed border-zinc-800 rounded-2xl p-6 flex flex-col items-center gap-3">
                  <Database className="text-emerald-500" size={24} />
                  <p className="text-xs text-zinc-400">Banco vazio? Restaure o guia padrao.</p>
                  <button
                    onClick={() => void handleSeedGuia()}
                    disabled={isSaving}
                    className="bg-zinc-800 hover:bg-emerald-500/10 hover:text-emerald-500 border border-zinc-700 hover:border-emerald-500 text-white px-6 py-3 rounded-xl text-xs font-bold uppercase flex items-center gap-2 transition"
                  >
                    {isSaving ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                    Restaurar Guia Padrao
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {isModalOpen && editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-zinc-900 w-full max-w-lg rounded-3xl border border-zinc-800 p-6 shadow-2xl relative my-auto animate-in zoom-in-95">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 text-zinc-500 hover:text-white">
              <X size={24} />
            </button>
            <h2 className="font-bold text-white text-xl mb-6 flex items-center gap-2 capitalize">
              {editingItem.id ? "Editar Item" : "Novo Item"}
              <span className="text-emerald-500">({activeTab})</span>
            </h2>

            <div className="space-y-4">
              {(activeTab === "academico" || activeTab === "grupos") && (
                <>
                  <div>
                    <label className="label-admin">Titulo do link</label>
                    <input
                      type="text"
                      className="input-admin"
                      value={editingItem.titulo || ""}
                      onChange={(event) => setEditingItem({ ...editingItem, titulo: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label-admin">URL de destino</label>
                    <input
                      type="text"
                      className="input-admin"
                      value={editingItem.url || ""}
                      onChange={(event) => setEditingItem({ ...editingItem, url: event.target.value })}
                    />
                  </div>
                </>
              )}

              {activeTab === "transporte" && (
                <>
                  <div>
                    <label className="label-admin">Nome da linha</label>
                    <input
                      type="text"
                      className="input-admin"
                      value={editingItem.nome || ""}
                      onChange={(event) => setEditingItem({ ...editingItem, nome: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label-admin">Horarios</label>
                    <input
                      type="text"
                      className="input-admin"
                      value={editingItem.horario || ""}
                      onChange={(event) => setEditingItem({ ...editingItem, horario: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label-admin">Detalhes / trajeto</label>
                    <input
                      type="text"
                      className="input-admin"
                      value={editingItem.detalhe || ""}
                      onChange={(event) => setEditingItem({ ...editingItem, detalhe: event.target.value })}
                    />
                  </div>
                </>
              )}

              {activeTab === "turismo" && (
                <>
                  <div className="bg-black/40 p-4 rounded-xl border border-zinc-800 border-dashed hover:border-emerald-500/50 transition text-center relative group h-40 flex items-center justify-center overflow-hidden">
                    {previewImage ? (
                      <Image src={previewImage} alt="Preview" fill unoptimized className="object-cover rounded-lg" />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-zinc-500">
                        <ImageIcon size={32} />
                        <span className="text-xs font-bold uppercase">Foto do local</span>
                      </div>
                    )}
                    <input
                      type="file"
                      className="absolute inset-0 opacity-0 cursor-pointer z-10"
                      accept="image/*"
                      onChange={handleFileChange}
                    />
                  </div>
                  <div>
                    <label className="label-admin">Nome do local</label>
                    <input
                      type="text"
                      className="input-admin"
                      value={editingItem.nome || ""}
                      onChange={(event) => setEditingItem({ ...editingItem, nome: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label-admin">Descricao curta</label>
                    <textarea
                      rows={2}
                      className="input-admin"
                      value={editingItem.descricao || ""}
                      onChange={(event) => setEditingItem({ ...editingItem, descricao: event.target.value })}
                    />
                  </div>
                </>
              )}

              {activeTab === "emergencia" && (
                <>
                  <div>
                    <label className="label-admin">Nome do servico</label>
                    <input
                      type="text"
                      className="input-admin"
                      value={editingItem.nome || ""}
                      onChange={(event) => setEditingItem({ ...editingItem, nome: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label-admin">Numero de telefone</label>
                    <input
                      type="text"
                      className="input-admin text-2xl font-black text-white"
                      value={editingItem.numero || ""}
                      onChange={(event) => setEditingItem({ ...editingItem, numero: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label-admin">Cor do icone</label>
                    <select
                      className="input-admin"
                      value={editingItem.cor || "red"}
                      onChange={(event) => setEditingItem({ ...editingItem, cor: event.target.value })}
                    >
                      <option value="red">Vermelho (emergencia)</option>
                      <option value="zinc">Cinza (geral)</option>
                      <option value="blue">Azul (servicos)</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 font-bold hover:bg-zinc-800 text-xs uppercase"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="px-8 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 shadow-lg text-xs uppercase flex items-center gap-2"
              >
                {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .label-admin {
          font-size: 10px;
          font-weight: 700;
          color: #71717a;
          text-transform: uppercase;
          margin-bottom: 4px;
          display: block;
        }
        .input-admin {
          width: 100%;
          background: #000;
          border: 1px solid #27272a;
          border-radius: 0.5rem;
          padding: 0.75rem;
          color: white;
          outline: none;
          font-size: 0.875rem;
          transition: border-color 0.2s;
        }
        .input-admin:focus {
          border-color: #10b981;
        }
      `}</style>
    </div>
  );
}
