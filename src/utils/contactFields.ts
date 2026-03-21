export const EMAIL_MAX_LENGTH = 160;
export const PHONE_MAX_DIGITS = 15;
export const PHONE_MAX_LENGTH = PHONE_MAX_DIGITS;
export const CPF_MAX_DIGITS = 11;
export const CPF_MASKED_MAX_LENGTH = 14;
export const PIX_KEY_MAX_LENGTH = 180;
export const PIX_BANK_MAX_LENGTH = 120;
export const PIX_HOLDER_MAX_LENGTH = 180;
export const URL_MAX_LENGTH = 400;

export const keepDigits = (value: string, maxDigits = PHONE_MAX_DIGITS): string =>
  value.replace(/\D/g, "").slice(0, maxDigits);

export const normalizePhoneInput = (
  value: string,
  maxDigits = PHONE_MAX_DIGITS
): string => keepDigits(value, maxDigits);

export const normalizePhoneToBrE164 = (
  value: string,
  maxLocalDigits = 11
): string => {
  const digits = value.replace(/\D/g, "");
  const withoutCountry = digits.startsWith("55") ? digits.slice(2) : digits;
  const localDigits = withoutCountry.slice(0, maxLocalDigits);
  return localDigits ? `+55${localDigits}` : "";
};

export const hasValidPhoneLength = (
  value: string,
  minDigits = 10,
  maxDigits = PHONE_MAX_DIGITS
): boolean => {
  const digits = keepDigits(value, maxDigits);
  return digits.length >= minDigits && digits.length <= maxDigits;
};

export const normalizeEmailInput = (
  value: string,
  maxLength = EMAIL_MAX_LENGTH
): string => value.slice(0, maxLength);

export const isValidEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase());

export const formatCpfInput = (value: string): string => {
  const digits = keepDigits(value, CPF_MAX_DIGITS);
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

export const isValidCpf = (value: string): boolean => {
  const digits = keepDigits(value, CPF_MAX_DIGITS);
  if (digits.length !== CPF_MAX_DIGITS || /^(\d)\1{10}$/.test(digits)) {
    return false;
  }

  const calculateDigit = (sliceLength: number): number => {
    const sum = digits
      .slice(0, sliceLength)
      .split("")
      .reduce((total, current, index) => {
        const multiplier = sliceLength + 1 - index;
        return total + Number(current) * multiplier;
      }, 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const firstDigit = calculateDigit(9);
  const secondDigit = calculateDigit(10);
  return firstDigit === Number(digits[9]) && secondDigit === Number(digits[10]);
};
