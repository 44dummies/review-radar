const DECL = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /\bclass\s+([A-Za-z_$][\w$]*)/,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
];

export function declaredSymbols(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    for (const re of DECL) {
      const m = re.exec(l);
      if (m && !out.includes(m[1]!)) { out.push(m[1]!); break; }
    }
  }
  return out;
}
