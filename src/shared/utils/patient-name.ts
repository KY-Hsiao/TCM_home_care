export function anonymizePatientName(name: string) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return "";
  }

  const chars = Array.from(normalizedName);
  if (chars.length <= 2) {
    return normalizedName;
  }

  return `${chars[0]}${"○".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

export function maskPatientName(name: string) {
  return anonymizePatientName(name);
}
