export interface ImageCompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

const DEFAULT_OPTIONS: Required<ImageCompressionOptions> = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.82,
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

export async function compressImageFile(
  file: File,
  options?: ImageCompressionOptions
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const config = { ...DEFAULT_OPTIONS, ...options };
  const image = await loadImageFromFile(file);

  const scale = Math.min(
    config.maxWidth / image.width,
    config.maxHeight / image.height,
    1
  );

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return file;

  context.drawImage(image, 0, 0, width, height);

  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await toBlob(canvas, mimeType, mimeType === "image/png" ? undefined : config.quality);
  if (!blob || blob.size >= file.size) return file;

  const sanitizedName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
  return new File([blob], sanitizedName, {
    type: blob.type,
    lastModified: Date.now(),
  });
}
