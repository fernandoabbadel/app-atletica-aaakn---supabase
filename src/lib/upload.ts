import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { storage } from "./firebase";

export interface UploadResult {
  url: string | null;
  error: string | null;
}

export const MAX_UPLOAD_IMAGE_MB = 2;
export const MAX_UPLOAD_IMAGE_BYTES = MAX_UPLOAD_IMAGE_MB * 1024 * 1024;
export const ALLOWED_UPLOAD_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const validateImageFile = (
  file: File,
  options?: {
    maxBytes?: number;
    allowedTypes?: readonly string[];
  }
): string | null => {
  const maxBytes = options?.maxBytes ?? MAX_UPLOAD_IMAGE_BYTES;
  const allowedTypes = options?.allowedTypes ?? ALLOWED_UPLOAD_IMAGE_TYPES;

  if (!file) return "Nenhum arquivo selecionado.";
  if (!allowedTypes.includes(file.type)) {
    return "Formato invalido. Use JPG, PNG ou WEBP.";
  }
  if (file.size > maxBytes) {
    const mbLimit = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
    return `A imagem excede ${mbLimit}MB.`;
  }

  return null;
};

export async function uploadImage(file: File, path: string): Promise<UploadResult> {
  const fileError = validateImageFile(file);
  if (fileError) {
    return { url: null, error: fileError };
  }

  try {
    const cleanName = file.name.replace(/[^a-zA-Z0-9.]/g, "_").toLowerCase();
    const filename = `${Date.now()}-${cleanName}`;
    const storageRef = ref(storage, `${path}/${filename}`);
    const snapshot = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);

    return { url, error: null };
  } catch (error: unknown) {
    console.error("Erro critico no upload:", error);
    return { url: null, error: "Falha ao subir imagem. Tente novamente." };
  }
}
