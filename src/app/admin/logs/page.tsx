"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Search,
  Filter,
  ShieldAlert,
  PlusCircle,
  Edit,
  Trash2,
  LogIn,
  AlertTriangle,
  Clock,
  Loader2,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";

import { useToast } from "@/context/ToastContext";
import { isFirebasePermissionError } from "@/lib/firebaseErrors";
import {
  fetchAdminActivityLogsPage,
  type AdminActivityLogRecord,
} from "@/lib/adminSecurityService";

const PAGE_SIZE = 20;

const toDate = (value: unknown): Date => {
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }

  if (typeof value === "object" && value !== null && "toDate" in value) {
    const maybeToDate = (value as { toDate?: unknown }).toDate;
    if (typeof maybeToDate === "function") {
      const dateResult = maybeToDate.call(value) as Date;
      if (dateResult instanceof Date) return dateResult;
    }
  }

  return new Date(0);
};

const mergeUniqueLogs = (
  current: AdminActivityLogRecord[],
  next: AdminActivityLogRecord[]
): AdminActivityLogRecord[] => {
  if (!next.length) return current;

  const ids = new Set(current.map((item) => item.id));
  const merged = [...current];

  next.forEach((item) => {
    if (ids.has(item.id)) return;
    ids.add(item.id);
    merged.push(item);
  });

  return merged;
};

export default function AdminLogsPage() {
  const { addToast } = useToast();

  const [logs, setLogs] = useState<AdminActivityLogRecord[]>([]);
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchAdminActivityLogsPage({
        pageSize: PAGE_SIZE,
        forceRefresh: false,
      });
      setLogs(result.logs);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (error: unknown) {
      if (isFirebasePermissionError(error)) {
        addToast("Sem permissao para acessar os logs.", "error");
      } else {
        console.error(error);
        addToast("Nao foi possivel carregar os logs agora.", "error");
      }
      setLogs([]);
      setCursor(null);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleLoadMore = async () => {
    if (!cursor || !hasMore || loadingMore) return;

    setLoadingMore(true);
    try {
      const result = await fetchAdminActivityLogsPage({
        pageSize: PAGE_SIZE,
        cursorId: cursor,
      });
      setLogs((prev) => mergeUniqueLogs(prev, result.logs));
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (error: unknown) {
      console.error(error);
      addToast("Nao foi possivel carregar mais logs.", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const getIcon = (action: string) => {
    switch (action) {
      case "CREATE":
        return <PlusCircle size={16} className="text-emerald-500" />;
      case "UPDATE":
        return <Edit size={16} className="text-blue-500" />;
      case "DELETE":
        return <Trash2 size={16} className="text-red-500" />;
      case "LOGIN":
        return <LogIn size={16} className="text-zinc-400" />;
      default:
        return <AlertTriangle size={16} className="text-yellow-500" />;
    }
  };

  const getColor = (action: string) => {
    switch (action) {
      case "CREATE":
        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
      case "DELETE":
        return "bg-red-500/10 text-red-500 border-red-500/20";
      case "UPDATE":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      default:
        return "bg-zinc-800 text-zinc-400 border-zinc-700";
    }
  };

  const logsFiltrados = useMemo(() => {
    const term = busca.trim().toLowerCase();
    if (!term) return logs;

    return logs.filter((log) => {
      const userName = (log.userName || "").toLowerCase();
      const details = (log.details || "").toLowerCase();
      const resource = (log.resource || "").toLowerCase();
      const action = (log.action || "").toLowerCase();

      return (
        userName.includes(term) ||
        details.includes(term) ||
        resource.includes(term) ||
        action.includes(term)
      );
    });
  }, [logs, busca]);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-10">
      <header className="p-6 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="bg-zinc-900 p-2 rounded-full hover:bg-zinc-800 transition"
          >
            <ArrowLeft size={20} className="text-zinc-400" />
          </Link>
          <h1 className="text-lg font-black text-white uppercase tracking-tighter flex items-center gap-2">
            <ShieldAlert size={20} className="text-emerald-500" /> Centro de
            Auditoria
          </h1>
        </div>
      </header>

      <main className="p-6 space-y-6">
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              type="text"
              placeholder="Buscar por usuario, acao ou detalhe..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:border-emerald-500 outline-none transition"
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
            />
          </div>
          <button
            className="bg-zinc-900 border border-zinc-800 px-4 rounded-xl text-zinc-400 hover:text-white transition"
            aria-label="Filtro de logs"
          >
            <Filter size={18} />
          </button>
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="bg-zinc-900/50 p-6 rounded-xl border border-zinc-800/50 text-zinc-400 flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> Carregando logs...
            </div>
          ) : logsFiltrados.length === 0 ? (
            <div className="bg-zinc-900/50 p-6 rounded-xl border border-zinc-800/50 text-zinc-500 text-sm text-center">
              Nenhum log encontrado para o filtro aplicado.
            </div>
          ) : (
            logsFiltrados.map((log) => {
              const logDate = toDate(log.timestamp);
              return (
                <div
                  key={log.id}
                  className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800/50 flex items-center justify-between group hover:bg-zinc-900 hover:border-zinc-700 transition"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center border ${getColor(log.action)}`}
                    >
                      {getIcon(log.action)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">
                          {log.userName || "Sistema"}
                        </span>
                        <span className="text-[10px] text-zinc-500 uppercase font-black tracking-wider bg-black px-1.5 py-0.5 rounded">
                          {log.resource || "Sistema"}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {log.details || "Sem detalhes."}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1 text-zinc-500 text-xs font-mono">
                      <Clock size={12} />
                      {logDate.toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <span className="text-[10px] text-zinc-600 font-bold uppercase">
                      {logDate.toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {!loading && hasMore && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="w-full bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-xl text-sm font-bold uppercase tracking-wide text-zinc-200 hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            {loadingMore ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Carregando...
              </>
            ) : (
              <>
                <ChevronDown size={16} />
                Carregar mais logs
              </>
            )}
          </button>
        )}
      </main>
    </div>
  );
}
