export interface ImageCompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  minQuality?: number;
  maxBytes?: number;
}

const DEFAULT_OPTIONS: Required<ImageCompressionOptions> = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.82,
  minQuality: 0.45,
  maxBytes: 200 * 1024,
};

const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Falha ao processar imagem"));
    };
    image.src = objectUrl;
  });

const toBlob = (
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      mimeType,
      typeof quality === "number" ? quality : undefined
    );
  });

const fileNameToWebp = (name: string): string => {
  const withoutExt = name.replace(/\.[a-z0-9]+$/i, "") || "image";
  const sanitized = withoutExt
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${sanitized || "image"}.webp`;
};

const resolveCompressedLastModified = (file: File): number =>
  file.lastModified > 0 ? file.lastModified : Date.now();

export async function compressImageFile(
  file: File,
  options?: ImageCompressionOptions
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const config = { ...DEFAULT_OPTIONS, ...options };
  const image = await loadImageFromFile(file);

  const initialScale = Math.min(config.maxWidth / image.width, config.maxHeight / image.height, 1);
  let width = Math.max(1, Math.round(image.width * initialScale));
  let height = Math.max(1, Math.round(image.height * initialScale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return file;

  let bestBlob: Blob | null = null;
  const minDimension = 320;

  for (let dimensionAttempt = 0; dimensionAttempt < 8; dimensionAttempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    let currentQuality = config.quality;
    let smallestBlobThisRound: Blob | null = null;

    while (currentQuality >= config.minQuality) {
      const blob = await toBlob(canvas, "image/webp", currentQuality);
      if (blob) {
        if (!smallestBlobThisRound || blob.size < smallestBlobThisRound.size) {
          smallestBlobThisRound = blob;
        }
        if (blob.size <= config.maxBytes) {
          return new File([blob], fileNameToWebp(file.name), {
            type: "image/webp",
            lastModified: resolveCompressedLastModified(file),
          });
        }
      }

      currentQuality = Number((currentQuality - 0.08).toFixed(2));
    }

    if (smallestBlobThisRound && (!bestBlob || smallestBlobThisRound.size < bestBlob.size)) {
      bestBlob = smallestBlobThisRound;
    }

    if (width <= minDimension || height <= minDimension) {
      break;
    }

    width = Math.max(minDimension, Math.round(width * 0.85));
    height = Math.max(minDimension, Math.round(height * 0.85));
  }

  if (bestBlob) {
    return new File([bestBlob], fileNameToWebp(file.name), {
      type: "image/webp",
      lastModified: resolveCompressedLastModified(file),
    });
  }

  return file;
}
