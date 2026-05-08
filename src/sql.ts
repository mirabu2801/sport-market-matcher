export function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

export function quoteIdentPath(path: string): string {
  const parts = path.split('.');
  if (parts.some((part) => part.length === 0)) {
    throw new Error(`Unsafe SQL identifier path: ${path}`);
  }

  return parts.map(quoteIdent).join('.');
}
