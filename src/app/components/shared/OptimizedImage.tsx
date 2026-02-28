"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import Image, { type ImageProps } from "next/image";
import { ImageOff } from "lucide-react";

export interface OptimizedImageProps extends Omit<ImageProps, "unoptimized"> {
  containerClassName?: string;
  fallbackClassName?: string;
  fallbackIconSize?: number;
}

const getContainerStyle = (
  fill: boolean | undefined,
  width: ImageProps["width"],
  height: ImageProps["height"]
): CSSProperties => {
  if (fill) {
    return { width: "100%", height: "100%" };
  }

  return { width, height };
};

export function OptimizedImage({
  src,
  alt,
  fill,
  width,
  height,
  className = "",
  containerClassName = "",
  fallbackClassName = "",
  sizes = "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw",
  fallbackIconSize = 32,
  onLoad,
  onError,
  ...props
}: OptimizedImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const containerStyle = getContainerStyle(fill, width, height);

  if (hasError || !src) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-800 text-slate-500 ${containerClassName} ${fallbackClassName}`.trim()}
        style={containerStyle}
      >
        <ImageOff size={fallbackIconSize} />
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${containerClassName}`.trim()}
      style={containerStyle}
    >
      {isLoading && (
        <div className="absolute inset-0 z-10 animate-pulse bg-slate-800" />
      )}

      <Image
        {...props}
        src={src}
        alt={alt}
        fill={fill}
        width={fill ? undefined : width}
        height={fill ? undefined : height}
        sizes={fill ? sizes : undefined}
        onLoad={(event) => {
          setIsLoading(false);
          onLoad?.(event);
        }}
        onError={(event) => {
          setIsLoading(false);
          setHasError(true);
          onError?.(event);
        }}
        className={`object-cover transition-all duration-700 ease-in-out ${isLoading ? "scale-105 blur-sm" : "scale-100 blur-0"} ${className}`.trim()}
      />
    </div>
  );
}
