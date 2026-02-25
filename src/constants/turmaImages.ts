const EXTENSIONS_PRIORITY = ["jpeg", "jpg", "webp", "png"] as const;

const TURMA_IMAGE_BY_ID: Record<string, string> = {
  T1: "/turma1.jpeg",
  T2: "/turma2.jpeg",
  T3: "/turma3.jpeg",
  T4: "/turma4.jpeg",
  T5: "/turma5.jpeg",
  T6: "/turma6.jpeg",
  T7: "/turma7.jpeg",
  T8: "/turma8.jpg",
  T9: "/turma9.jpg",
};

export { TURMA_IMAGE_BY_ID };

const normalizeTurmaId = (turma?: string): string | null => {
  if (!turma) return null;

  const normalized = turma.trim().toUpperCase();
  if (TURMA_IMAGE_BY_ID[normalized]) return normalized;

  const digits = normalized.replace(/\D/g, "");
  if (!digits) return null;

  const key = `T${digits}`;
  return TURMA_IMAGE_BY_ID[key] ? key : null;
};

export function getTurmaImageCandidates(
  turma?: string,
  fallback = "/logo.png"
): string[] {
  const turmaId = normalizeTurmaId(turma);
  if (!turmaId) return [fallback];

  const preferredPath = TURMA_IMAGE_BY_ID[turmaId];
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
