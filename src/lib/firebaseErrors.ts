// Mantemos este helper durante a migracao para evitar quebrar imports antigos.
// Ele continua util mesmo quando a origem do erro nao e exatamente Firebase.

export function getFirebaseErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isFirebasePermissionError(error: unknown): boolean {
  const code = getFirebaseErrorCode(error);
  if (code) {
    const normalizedCode = code.toLowerCase();
    if (
      normalizedCode.includes("permission-denied") ||
      normalizedCode.includes("permission_denied")
    ) {
      return true;
    }
  }

  if (error instanceof Error) {
    return error.message
      .toLowerCase()
      .includes("missing or insufficient permissions");
  }

  return false;
}

