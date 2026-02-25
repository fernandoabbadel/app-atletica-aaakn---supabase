// Helper generico de erros de backend (Supabase/Edge/RPC/compat layer).

export function getBackendErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isPermissionError(error: unknown): boolean {
  const code = getBackendErrorCode(error);
  if (code) {
    const normalizedCode = code.toLowerCase();
    if (
      normalizedCode.includes("permission-denied") ||
      normalizedCode.includes("permission_denied") ||
      normalizedCode.includes("forbidden") ||
      normalizedCode.includes("not-authorized")
    ) {
      return true;
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("insufficient permissions") ||
      message.includes("not authorized") ||
      message.includes("forbidden") ||
      message.includes("permission")
    );
  }

  return false;
}
