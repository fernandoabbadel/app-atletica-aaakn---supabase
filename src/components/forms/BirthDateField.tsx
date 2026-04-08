"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar } from "lucide-react";

import {
  buildBirthDateValue,
  extractBirthDateParts,
  getBirthYearOptions,
  getDaysInMonth,
  normalizeBirthDateParts,
  type BirthDateParts,
} from "@/lib/birthDate";

type BirthDateFieldProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const MONTH_OPTIONS = [
  { value: "01", label: "Jan" },
  { value: "02", label: "Fev" },
  { value: "03", label: "Mar" },
  { value: "04", label: "Abr" },
  { value: "05", label: "Mai" },
  { value: "06", label: "Jun" },
  { value: "07", label: "Jul" },
  { value: "08", label: "Ago" },
  { value: "09", label: "Set" },
  { value: "10", label: "Out" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dez" },
];

const SELECT_CLASS_NAME =
  "h-10 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm font-semibold text-white outline-none transition focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60";

export default function BirthDateField({
  value,
  onChange,
  disabled = false,
}: BirthDateFieldProps) {
  const [parts, setParts] = useState<BirthDateParts>(() => extractBirthDateParts(value));

  useEffect(() => {
    const nextParts = extractBirthDateParts(value);
    const nextValue = buildBirthDateValue(nextParts);
    const currentValue = buildBirthDateValue(parts);
    if (nextValue === currentValue) return;
    setParts(nextParts);
  }, [parts, value]);

  const availableDays = useMemo(() => {
    const totalDays = getDaysInMonth(parts.month, parts.year);
    return Array.from({ length: totalDays }, (_, index) => String(index + 1).padStart(2, "0"));
  }, [parts.month, parts.year]);

  const yearOptions = useMemo(() => getBirthYearOptions(1930), []);

  const handleUpdate = (patch: Partial<BirthDateParts>) => {
    setParts((currentParts) => {
      const nextParts = normalizeBirthDateParts({ ...currentParts, ...patch });
      onChange(buildBirthDateValue(nextParts));
      return nextParts;
    });
  };

  return (
    <div className="relative flex h-14 w-full items-center rounded-[1.25rem] border border-zinc-800 bg-black pl-14 pr-3 transition focus-within:border-emerald-500 focus-within:shadow-[0_0_15px_rgba(16,185,129,0.1)]">
      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />

      <div className="grid w-full grid-cols-3 gap-2">
        <select
          value={parts.day}
          onChange={(event) => handleUpdate({ day: event.target.value })}
          className={SELECT_CLASS_NAME}
          disabled={disabled}
        >
          <option value="">Dia</option>
          {availableDays.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </select>

        <select
          value={parts.month}
          onChange={(event) => handleUpdate({ month: event.target.value })}
          className={SELECT_CLASS_NAME}
          disabled={disabled}
        >
          <option value="">Mes</option>
          {MONTH_OPTIONS.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </select>

        <select
          value={parts.year}
          onChange={(event) => handleUpdate({ year: event.target.value })}
          className={SELECT_CLASS_NAME}
          disabled={disabled}
        >
          <option value="">Ano</option>
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
