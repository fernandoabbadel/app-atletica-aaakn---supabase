import { normalizeTurmaId, resolveActiveTurmaConfig } from "@/lib/turmasService";

const EXTENSIONS_PRIORITY = ["jpeg", "jpg", "webp", "png"] as const;

const TURMA_IMAGE_BY_ID: Record<string, string> = {
  T1: "/turma1.jpeg",
  T2: "/turma2.jpeg",
  T3: "/turma3.jpeg",
  T4: "/turma4.jpeg",
  T5: "/turma5.jpeg",
  T6: "/turma6.jpeg",
  T7: "/turma7.jpeg",
  T8: "/turma8.jpeg",
  T9: "/turma9.jpeg",
};

export { TURMA_IMAGE_BY_ID };

const resolvePreferredTurmaImage = (turmaId: string): string => {
  const activeTurma = resolveActiveTurmaConfig(turmaId);
  const activeLogo = activeTurma?.logo.trim();
  if (activeLogo) return activeLogo;
  return TURMA_IMAGE_BY_ID[turmaId] || "";
};

export function getTurmaImageCandidates(
  turma?: string,
  fallback = "/logo.png"
): string[] {
  const turmaId = normalizeTurmaId(turma || "");
  if (!turmaId) return [fallback];

  const preferredPath = resolvePreferredTurmaImage(turmaId);
  if (!preferredPath) return [fallback];
  const match = preferredPath.match(/^\/(turma\d+)\.(\w+)$/i);
  if (!match) return [preferredPath, fallback];

  const [, baseName, preferredExtension] = match;
  const extensions = [
    preferredExtension.toLowerCase(),
    ...EXTENSIONS_PRIORITY.filter(
      (ext) => ext !== preferredExtension.toLowerCase()
    ),
  ];

  const candidates = extensions.map((ext) => `/${baseName}.${ext}`);
  if (!candidates.includes(fallback)) candidates.push(fallback);

  return candidates;
}

export function getTurmaImage(turma?: string, fallback = "/logo.png"): string {
  return getTurmaImageCandidates(turma, fallback)[0];
}
