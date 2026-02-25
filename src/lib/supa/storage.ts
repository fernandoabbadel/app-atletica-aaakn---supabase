import { getSupabaseClient } from "../supabase";

export interface StorageInstance {
  defaultBucket: string;
}

export interface StorageReference {
  bucket: string;
  fullPath: string;
  name: string;
}

export interface UploadResult {
  ref: StorageReference;
  metadata?: Record<string, unknown>;
}

const DEFAULT_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ||
  "public";

export function getStorage(): StorageInstance {
  return {
    defaultBucket: DEFAULT_BUCKET,
  };
}

const splitBucketAndPath = (
  storage: StorageInstance,
  path: string
): { bucket: string; fullPath: string } => {
  const clean = path.trim().replace(/^\/+/, "");

  // Permite formato explicito "bucket:path" para casos especiais.
  const bucketPrefixIndex = clean.indexOf(":");
  if (bucketPrefixIndex > 0 && !clean.startsWith("http")) {
    const bucket = clean.slice(0, bucketPrefixIndex).trim();
    const fullPath = clean.slice(bucketPrefixIndex + 1).trim().replace(/^\/+/, "");
    if (bucket && fullPath) {
      return { bucket, fullPath };
    }
  }

  return {
    bucket: storage.defaultBucket,
    fullPath: clean,
  };
};

export function ref(storage: StorageInstance, path: string): StorageReference {
  const { bucket, fullPath } = splitBucketAndPath(storage, path);
  const parts = fullPath.split("/").filter(Boolean);
  return {
    bucket,
    fullPath,
    name: parts.length ? parts[parts.length - 1] : fullPath,
  };
}

export async function uploadBytes(
  storageRef: StorageReference,
  data: Blob | File | ArrayBuffer | Uint8Array,
  options?: {
    contentType?: string;
    cacheControl?: string;
    upsert?: boolean;
  }
): Promise<UploadResult> {
  const supabase = getSupabaseClient();

  const payload = data instanceof Uint8Array || data instanceof ArrayBuffer || data instanceof Blob
    ? data
    : (data as Blob);

  const contentType =
    options?.contentType ||
    (typeof File !== "undefined" && data instanceof File ? data.type : undefined) ||
    (typeof Blob !== "undefined" && data instanceof Blob ? data.type : undefined) ||
    "application/octet-stream";

  const { error } = await supabase.storage
    .from(storageRef.bucket)
    .upload(storageRef.fullPath, payload, {
      upsert: options?.upsert ?? true,
      contentType,
      cacheControl: options?.cacheControl,
    });

  if (error) {
    throw Object.assign(new Error(error.message), {
      code: `storage/${error.name ?? "upload-failed"}`,
      cause: error,
    });
  }

  return {
    ref: storageRef,
    metadata: { contentType },
  };
}

export async function getDownloadURL(storageRef: StorageReference): Promise<string> {
  const supabase = getSupabaseClient();

  const publicUrl = supabase.storage
    .from(storageRef.bucket)
    .getPublicUrl(storageRef.fullPath).data.publicUrl;

  if (publicUrl) {
    return publicUrl;
  }

  const signed = await supabase.storage
    .from(storageRef.bucket)
    .createSignedUrl(storageRef.fullPath, 60 * 60 * 24 * 30);

  if (signed.error || !signed.data?.signedUrl) {
    const error = signed.error
      ? Object.assign(new Error(signed.error.message), {
          code: `storage/${signed.error.name ?? "signed-url-failed"}`,
          cause: signed.error,
        })
      : new Error("Falha ao gerar URL de download.");
    throw error;
  }

  return signed.data.signedUrl;
}
