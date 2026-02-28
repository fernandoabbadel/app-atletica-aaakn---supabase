type SerializableValue =
  | null
  | string
  | number
  | boolean
  | SerializableValue[]
  | { [key: string]: SerializableValue };

const isDateLike = (value: unknown): value is { toDate: () => Date } => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  );
};

const toSerializable = (value: unknown): SerializableValue => {
  if (value === null || value === undefined) return null;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item));
  }

  if (isDateLike(value)) {
    const parsed = value.toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, SerializableValue> = {};
    Object.entries(source).forEach(([key, item]) => {
      out[key] = toSerializable(item);
    });
    return out;
  }

  return null;
};

export const serializeForClient = <T>(value: T): T =>
  toSerializable(value) as T;

