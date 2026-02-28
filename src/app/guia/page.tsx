import GuiaClientPage, {
  type GuiaItem,
  type GuiaState,
} from "./GuiaClientPage";
import { fetchGuideData, type GuideCategory } from "../../lib/guiaService";
import { serializeForClient } from "../../lib/clientSerialization";

export const revalidate = 60;

const sortItems = (rows: GuiaItem[]): GuiaItem[] =>
  [...rows].sort((left, right) => {
    const leftOrder =
      typeof left.ordem === "number" ? left.ordem : Number.MAX_SAFE_INTEGER;
    const rightOrder =
      typeof right.ordem === "number" ? right.ordem : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    const leftLabel = left.titulo || left.nome || "";
    const rightLabel = right.titulo || right.nome || "";
    return leftLabel.localeCompare(rightLabel, "pt-BR");
  });

const mapRows = (rows: Record<string, unknown>[]): GuiaItem[] =>
  sortItems(
    rows.map((row) =>
      serializeForClient(row as unknown as GuiaItem)
    )
  );

export default async function GuiaPage() {
  const initialGuiaData: GuiaState = {
    academico: [],
    transporte: [],
    turismo: [],
    emergencia: [],
    grupos: [],
  };

  try {
    const categories: GuideCategory[] = [
      "academico",
      "transporte",
      "turismo",
      "emergencia",
      "grupos",
    ];

    const rowsByCategory = await Promise.all(
      categories.map((category) =>
        fetchGuideData({ category, maxResults: 80, forceRefresh: false })
      )
    );

    const [academicoRows, transporteRows, turismoRows, emergenciaRows, gruposRows] =
      rowsByCategory;

    initialGuiaData.academico = mapRows(academicoRows as Record<string, unknown>[]);
    initialGuiaData.transporte = mapRows(transporteRows as Record<string, unknown>[]);
    initialGuiaData.turismo = mapRows(turismoRows as Record<string, unknown>[]);
    initialGuiaData.emergencia = mapRows(emergenciaRows as Record<string, unknown>[]);
    initialGuiaData.grupos = mapRows(gruposRows as Record<string, unknown>[]);
  } catch {
    // Mantem layout com listas vazias se houver falha temporaria.
  }

  return <GuiaClientPage initialGuiaData={initialGuiaData} />;
}
