"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Power, Loader2, ArrowLeft, Copy, Save } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

import { useToast } from "../../../context/ToastContext";
import {
  fetchSharkroundLeagues,
  setSharkroundLeagueActive,
} from "../../../lib/sharkroundService";
import {
  fetchSharkroundAppConfig,
  getDefaultSharkroundAppConfig,
  saveSharkroundAppConfig,
  type SharkroundAppConfig,
} from "../../../lib/sharkroundConfigService";

interface Questao {
  id: string;
  pergunta: string;
  respostas: string[];
  correta: number;
}

interface LigaConfig {
  id: string;
  nome: string;
  senha: string;
  ativa: boolean;
  perguntas: Questao[];
  foto?: string;
  sigla?: string;
}

export default function AdminSharkRound() {
  const { addToast } = useToast();

  const [loadingLigas, setLoadingLigas] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  const [ligas, setLigas] = useState<LigaConfig[]>([]);
  const [config, setConfig] = useState<SharkroundAppConfig>(
    getDefaultSharkroundAppConfig()
  );
  const [rulesText, setRulesText] = useState(
    getDefaultSharkroundAppConfig().rules.join("\n")
  );

  const stats = useMemo(() => {
    const ativas = ligas.filter((league) => league.ativa).length;
    return { ativas, total: ligas.length };
  }, [ligas]);

  const loadLigas = useCallback(
    async (forceRefresh = false) => {
      setLoadingLigas(true);
      try {
        const loaded = await fetchSharkroundLeagues({
          maxResults: 160,
          forceRefresh,
        });
        setLigas(loaded as LigaConfig[]);
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar ligas.", "error");
      } finally {
        setLoadingLigas(false);
      }
    },
    [addToast]
  );

  const loadConfig = useCallback(
    async (forceRefresh = false) => {
      setLoadingConfig(true);
      try {
        const loadedConfig = await fetchSharkroundAppConfig({ forceRefresh });
        setConfig(loadedConfig);
        setRulesText(loadedConfig.rules.join("\n"));
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar configuracoes.", "error");
      } finally {
        setLoadingConfig(false);
      }
    },
    [addToast]
  );

  useEffect(() => {
    void Promise.all([loadLigas(), loadConfig()]);
  }, [loadLigas, loadConfig]);

  const toggleLiga = async (liga: LigaConfig) => {
    const novoStatus = !liga.ativa;
    const qCount = liga.perguntas?.length || 0;

    if (novoStatus && qCount < 10) {
      addToast(`Bloqueado: a liga precisa de 10 perguntas (atual: ${qCount}).`, "error");
      return;
    }

    const previous = ligas;
    setLigas((current) =>
      current.map((entry) =>
        entry.id === liga.id ? { ...entry, ativa: novoStatus } : entry
      )
    );

    try {
      await setSharkroundLeagueActive({ leagueId: liga.id, ativa: novoStatus });
      addToast(
        novoStatus
          ? "Liga ativada no tabuleiro."
          : "Liga removida do tabuleiro.",
        "success"
      );
    } catch (error: unknown) {
      console.error(error);
      setLigas(previous);
      addToast("Erro ao atualizar liga.", "error");
    } finally {
      await loadLigas(true);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addToast("Senha copiada.", "success");
  };

  const handleConfigNumber = (
    key: keyof Omit<SharkroundAppConfig, "rules">,
    value: string
  ) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? parsed : 0;
    setConfig((current) => ({ ...current, [key]: safe }));
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const rules = rulesText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 16);

      const payload: SharkroundAppConfig = {
        ...config,
        rules: rules.length > 0 ? rules : getDefaultSharkroundAppConfig().rules,
      };

      await saveSharkroundAppConfig(payload);
      setConfig(payload);
      setRulesText(payload.rules.join("\n"));
      addToast("Configuracoes salvas.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar configuracoes.", "error");
    } finally {
      setSavingConfig(false);
    }
  };

  if (loadingLigas || loadingConfig) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500 w-12 h-12" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6 pb-20">
      <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-8 gap-4 border-b border-zinc-800 pb-6 sticky top-0 bg-zinc-950/95 backdrop-blur z-20 pt-4">
        <div className="flex items-center gap-4">
          <Link
            href="/admin"
            className="p-3 bg-zinc-900 rounded-full hover:bg-zinc-800 border border-zinc-700 transition"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-black uppercase">Admin SharkRound</h1>
            <p className="text-xs text-zinc-500">
              Controle de ligas e configuracao global do jogo.
            </p>
          </div>
        </div>

        <div className="flex gap-4 items-center bg-zinc-900 p-3 rounded-xl border border-zinc-800 shadow-lg">
          <div className="text-right">
            <p className="text-[10px] text-zinc-500 uppercase font-bold">Ligas ativas</p>
            <p className="text-lg font-black text-emerald-500 leading-none">
              {stats.ativas}
            </p>
          </div>
          <div className="h-8 w-[1px] bg-zinc-700" />
          <div className="text-right">
            <p className="text-[10px] text-zinc-500 uppercase font-bold">Casas</p>
            <p className="text-lg font-black text-white leading-none">
              {stats.ativas * 2 + 4}
            </p>
          </div>
        </div>
      </header>

      <section className="mb-8 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wide">Configuracao do jogo</h2>
            <p className="text-[11px] text-zinc-500">Documento unico em `app_config/sharkround`</p>
          </div>
          <button
            onClick={() => void handleSaveConfig()}
            disabled={savingConfig}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase inline-flex items-center gap-2 disabled:opacity-60"
          >
            {savingConfig ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <label className="text-xs font-bold uppercase text-zinc-400">
            Jogadas por dia
            <input
              type="number"
              min={1}
              max={20}
              value={config.dailyRollsLimit}
              onChange={(event) => handleConfigNumber("dailyRollsLimit", event.target.value)}
              className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs font-bold uppercase text-zinc-400">
            Moedas iniciais
            <input
              type="number"
              min={0}
              max={10000}
              value={config.startingCoins}
              onChange={(event) => handleConfigNumber("startingCoins", event.target.value)}
              className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs font-bold uppercase text-zinc-400">
            Fianca da DP
            <input
              type="number"
              min={0}
              max={10000}
              value={config.bailCost}
              onChange={(event) => handleConfigNumber("bailCost", event.target.value)}
              className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs font-bold uppercase text-zinc-400">
            Coracoes para libertar
            <input
              type="number"
              min={1}
              max={20}
              value={config.heartTarget}
              onChange={(event) => handleConfigNumber("heartTarget", event.target.value)}
              className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs font-bold uppercase text-zinc-400">
            Recompensa por ajudar
            <input
              type="number"
              min={0}
              max={500}
              value={config.heartHelpReward}
              onChange={(event) => handleConfigNumber("heartHelpReward", event.target.value)}
              className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="text-xs font-bold uppercase text-zinc-400">
            Bonus por ciclo
            <input
              type="number"
              min={0}
              max={5000}
              value={config.cycleBaseReward}
              onChange={(event) => handleConfigNumber("cycleBaseReward", event.target.value)}
              className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>

        <label className="text-xs font-bold uppercase text-zinc-400 block">
          Regras (uma por linha)
          <textarea
            rows={8}
            value={rulesText}
            onChange={(event) => setRulesText(event.target.value)}
            className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-sm text-white"
          />
        </label>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {ligas.map((liga) => {
          const qCount = liga.perguntas?.length || 0;
          const canActivate = qCount >= 10;

          return (
            <div
              key={liga.id}
              className={`p-5 rounded-2xl border transition-all ${
                liga.ativa
                  ? "bg-zinc-900 border-emerald-500/50 shadow-lg"
                  : "bg-zinc-950 border-zinc-800 opacity-80"
              }`}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="relative w-12 h-12 shrink-0">
                    <Image
                      src={liga.foto || "https://github.com/shadcn.png"}
                      alt={liga.nome}
                      fill
                      
                      className="rounded-full object-cover border-2 border-zinc-800 bg-black"
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm text-white truncate">{liga.nome}</h3>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        canActivate
                          ? "bg-emerald-500/10 text-emerald-500"
                          : "bg-red-500/10 text-red-500"
                      }`}
                    >
                      {qCount}/10 perguntas
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => void toggleLiga(liga)}
                  disabled={!canActivate && !liga.ativa}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${
                    liga.ativa
                      ? "bg-emerald-500 text-black"
                      : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  <Power size={18} strokeWidth={3} />
                </button>
              </div>
              <div className="bg-black/50 p-3 rounded-xl border border-zinc-800/50 flex items-center justify-between mb-3">
                <span className="text-xs font-mono text-zinc-300">{liga.senha}</span>
                <button
                  onClick={() => copyToClipboard(liga.senha)}
                  className="text-zinc-500 hover:text-white transition"
                >
                  <Copy size={14} />
                </button>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase pt-2 border-t border-zinc-800">
                <span className={liga.ativa ? "text-emerald-500" : "text-zinc-600"}>
                  {liga.ativa ? "No tabuleiro" : "Inativa"}
                </span>
                {!canActivate && !liga.ativa ? (
                  <span className="text-red-500 animate-pulse">Incompleta</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
