import { getSupabaseClient } from "./supabase";
import { compressImageFile } from "./imageCompression";

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
    // Canvas compression reduces Storage usage and egress while keeping quality acceptable.
    const optimizedFile = await compressImageFile(file, {
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 0.82,
    });

    const optimizedError = validateImageFile(optimizedFile);
    if (optimizedError) {
      return { url: null, error: optimizedError };
    }

    const supabase = getSupabaseClient();
    const bucket = (process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || "uploads").trim() || "uploads";
    const cleanName = optimizedFile.name.replace(/[^a-zA-Z0-9.]/g, "_").toLowerCase();
    const filename = `${Date.now()}-${cleanName}`;
    const objectPath = `${path}/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(objectPath, optimizedFile, {
        upsert: false,
        cacheControl: "3600",
        contentType: optimizedFile.type || undefined,
      });

    if (uploadError) {
      throw uploadError;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    const url = publicUrl || null;

    return { url, error: null };
  } catch (error: unknown) {
    console.error("Erro critico no upload:", error);
    return { url: null, error: "Falha ao subir imagem. Tente novamente." };
  }
}

