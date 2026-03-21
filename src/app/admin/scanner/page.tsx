"use client";

import { useState } from "react";

import { scanSupabaseTableFields } from "@/lib/partnersService";

export default function ScannerPage() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Record<string, string[]>>({});

  const scanDatabase = async () => {
    setLoading(true);
    const collectionsToScan = ["users", "produtos", "eventos", "orders", "parceiros"];

    try {
      const results = await scanSupabaseTableFields({
        collections: collectionsToScan,
        sampleDocsPerCollection: 40,
      });
      setReport(results);
      console.log("Campos identificados:", results);
    } catch (error: unknown) {
      console.error("Erro ao escanear campos:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 bg-slate-900 text-white min-h-screen">
      <h1 className="text-2xl font-bold mb-4">Scanner de Campos do Banco</h1>
      <button
        onClick={scanDatabase}
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-bold disabled:opacity-50"
      >
        {loading ? "Escaneando tabelas..." : "Iniciar escaneamento"}
      </button>

      <div className="mt-8 space-y-4">
        {Object.entries(report).map(([collection, fields]) => (
          <div key={collection} className="border border-slate-700 p-4 rounded-lg bg-slate-800">
            <h2 className="text-xl font-semibold text-blue-400 capitalize">{collection}</h2>
            <div className="flex flex-wrap gap-2 mt-2">
              {fields.map((field) => (
                <span
                  key={field}
                  className="bg-slate-700 px-2 py-1 rounded text-sm font-mono text-green-400"
                >
                  {field}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
