"use client";

import { useEffect, useMemo } from "react";

const LOT_OPTIONS = ["Lote 1", "Lote 2", "Lote 3", "Lote 4", "Lote 5", "Outro"] as const;
const CATEGORY_OPTIONS = ["Aluno", "Não Aluno", "Outro"] as const;

type LotOption = (typeof LOT_OPTIONS)[number];
type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

type ParsedLotName = {
  lote: LotOption;
  categoria: CategoryOption;
  loteOutro: string;
  categoriaOutro: string;
};

type LotNameSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  containerClassName?: string;
  selectClassName?: string;
  inputClassName?: string;
};

const DEFAULT_SELECT_CLASS =
  "rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500";

const DEFAULT_INPUT_CLASS =
  "rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-500";

const DEFAULT_CONTAINER_CLASS = "grid grid-cols-1 gap-2 md:grid-cols-2";

export function parseStandardLotName(value: string): ParsedLotName {
  const raw = value.trim();
  if (!raw) {
    return {
      lote: "Lote 1",
      categoria: "Aluno",
      loteOutro: "",
      categoriaOutro: "",
    };
  }
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const loteMatch = normalized.match(/lote\s*([1-5])/);
  const lote = loteMatch ? (`Lote ${loteMatch[1]}` as LotOption) : "Outro";
  const categoria = normalized.includes("nao aluno") || normalized.includes("não aluno")
    ? "Não Aluno"
    : normalized.includes("aluno")
      ? "Aluno"
      : "Outro";

  const parts = raw.split(/\s+-\s+/);
  return {
    lote,
    categoria,
    loteOutro: lote === "Outro" ? parts[0] || raw || "" : "",
    categoriaOutro: categoria === "Outro" ? parts[1] || "" : "",
  };
}

export function composeStandardLotName(
  lote: LotOption,
  categoria: CategoryOption,
  loteOutro = "",
  categoriaOutro = "",
  maxLength = 80
) {
  const loteLabel = lote === "Outro" ? loteOutro.trim() || "Outro lote" : lote;
  const categoriaLabel = categoria === "Outro" ? categoriaOutro.trim() || "Outro" : categoria;
  return `${loteLabel} - ${categoriaLabel}`.slice(0, maxLength);
}

export function LotNameSelector({
  value,
  onChange,
  maxLength = 80,
  containerClassName = DEFAULT_CONTAINER_CLASS,
  selectClassName = DEFAULT_SELECT_CLASS,
  inputClassName = DEFAULT_INPUT_CLASS,
}: LotNameSelectorProps) {
  const parsed = useMemo(() => parseStandardLotName(value), [value]);

  useEffect(() => {
    if (!value.trim()) {
      onChange(composeStandardLotName("Lote 1", "Aluno", "", "", maxLength));
    }
  }, [maxLength, onChange, value]);

  const update = (patch: Partial<ParsedLotName>) => {
    const next = { ...parsed, ...patch };
    onChange(composeStandardLotName(next.lote, next.categoria, next.loteOutro, next.categoriaOutro, maxLength));
  };

  return (
    <div className={containerClassName}>
      <label className="space-y-1">
        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">Lote</span>
        <select value={parsed.lote} onChange={(event) => update({ lote: event.target.value as LotOption })} className={selectClassName}>
          {LOT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">Categoria</span>
        <select
          value={parsed.categoria}
          onChange={(event) => update({ categoria: event.target.value as CategoryOption })}
          className={selectClassName}
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      {parsed.lote === "Outro" ? (
        <input
          value={parsed.loteOutro}
          maxLength={maxLength}
          onChange={(event) => update({ loteOutro: event.target.value.slice(0, maxLength) })}
          placeholder="Nome do lote"
          className={inputClassName}
        />
      ) : null}
      {parsed.categoria === "Outro" ? (
        <input
          value={parsed.categoriaOutro}
          maxLength={maxLength}
          onChange={(event) => update({ categoriaOutro: event.target.value.slice(0, maxLength) })}
          placeholder="Nome da categoria"
          className={inputClassName}
        />
      ) : null}
    </div>
  );
}
