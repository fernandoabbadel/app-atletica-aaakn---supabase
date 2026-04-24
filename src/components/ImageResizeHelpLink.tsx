import Link from "next/link";

export const IMAGE_RESIZE_HELP_URL = "https://squoosh.app/";

const normalizeResizeHelpLabel = (label: string): string =>
  label
    .replace(/favicon\.io\/favicon-converter/gi, "Squoosh.app")
    .replace(/favicon\.io/gi, "Squoosh.app");

export function ImageResizeHelpLink({
  label = "Compactar imagem antes do upload",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  const normalizedLabel = normalizeResizeHelpLabel(label);

  return (
    <Link
      href={IMAGE_RESIZE_HELP_URL}
      target="_blank"
      rel="noreferrer"
      title="Abrir Squoosh.app em nova aba"
      className={`inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 underline underline-offset-4 hover:text-emerald-200 ${className}`.trim()}
    >
      {normalizedLabel}
    </Link>
  );
}
