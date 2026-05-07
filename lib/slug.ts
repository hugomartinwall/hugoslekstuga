// Tokenize input into words, then format into various conventions.

export function tokenize(input: string): string[] {
  if (!input) return [];
  // Decompose Unicode and strip combining marks (so é → e, ñ → n).
  let s = input.normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Insert spaces at camelCase boundaries: aBc → a Bc, ABCdef → ABC def
  s = s.replace(/([a-z\d])([A-Z])/g, "$1 $2");
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  // Replace anything that isn't a letter or digit with a space.
  s = s.replace(/[^a-zA-Z0-9]+/g, " ");
  return s.trim().split(/\s+/).filter(Boolean);
}

export function toSlug(input: string): string {
  return tokenize(input).join("-").toLowerCase();
}

export function toKebab(input: string): string {
  return toSlug(input);
}

export function toSnake(input: string): string {
  return tokenize(input).join("_").toLowerCase();
}

export function toConstant(input: string): string {
  return tokenize(input).join("_").toUpperCase();
}

export function toCamel(input: string): string {
  const t = tokenize(input);
  if (t.length === 0) return "";
  return [
    t[0].toLowerCase(),
    ...t.slice(1).map(capFirst),
  ].join("");
}

export function toPascal(input: string): string {
  return tokenize(input).map(capFirst).join("");
}

export function toTitle(input: string): string {
  return tokenize(input).map(capFirst).join(" ");
}

export function toSentence(input: string): string {
  const t = tokenize(input).map((w) => w.toLowerCase());
  if (t.length === 0) return "";
  t[0] = capFirst(t[0]);
  return t.join(" ");
}

export function toLower(input: string): string {
  return tokenize(input).join(" ").toLowerCase();
}

export function toUpper(input: string): string {
  return tokenize(input).join(" ").toUpperCase();
}

function capFirst(w: string): string {
  if (!w) return w;
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}
