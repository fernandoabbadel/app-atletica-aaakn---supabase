import Link from "next/link";

export const IMAGE_RESIZE_HELP_URL = "https://favicon.io/favicon-converter/";

export function ImageResizeHelpLink({
  label = "Diminuir imagem antes do upload",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={IMAGE_RESIZE_HELP_URL}
      target="_blank"
      rel="noreferrer"
      className={`text-[11px] font-medium text-zinc-400 underline underline-offset-4 hover:text-white ${className}`.trim()}
    >
      {label}
    </Link>
  );
}
