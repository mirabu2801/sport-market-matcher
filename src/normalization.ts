const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'be',
  'by',
  'for',
  'from',
  'game',
  'in',
  'is',
  'match',
  'market',
  'no',
  'of',
  'on',
  'or',
  'the',
  'to',
  'v',
  'vs',
  'will',
  'win',
  'winner',
  'with',
  'yes'
]);

const TEAM_SUFFIX_STOPWORDS = new Set([
  'club',
  'fc',
  'cf',
  'sc',
  'afc',
  'bc',
  'women',
  'w',
  'men',
  'team',
  'gc',
  'esport',
  'esports',
  'gaming'
]);

export function normalizeText(input: unknown): string {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[ðÐ]/g, 'd')
    .replace(/[þÞ]/g, 'th')
    .replace(/[łŁ]/g, 'l')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function tokenize(input: unknown, options: { keepStopwords?: boolean } = {}): string[] {
  const normalized = normalizeText(input);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(' ')
    .map(stemToken)
    .filter((token) => token.length > 1 || /^\d$/.test(token))
    .filter((token) => options.keepStopwords || !STOPWORDS.has(token));
}

export function uniqueTokens(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

export function significantNameTokens(name: unknown): string[] {
  return uniqueTokens(
    tokenize(name).filter((token) => !TEAM_SUFFIX_STOPWORDS.has(token) && !/^\d+$/.test(token))
  );
}

export function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.length > 4 && token.endsWith('s')) {
    return token.slice(0, -1);
  }

  return token;
}

export function jaccard(left: Iterable<string>, right: Iterable<string>): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 && rightSet.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function diceCoefficient(left: string, right: string): number {
  const a = normalizeText(left).replace(/\s+/g, '');
  const b = normalizeText(right).replace(/\s+/g, '');
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const bigram = a.slice(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }

  let hits = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const bigram = b.slice(i, i + 2);
    const count = bigrams.get(bigram) ?? 0;
    if (count > 0) {
      hits += 1;
      bigrams.set(bigram, count - 1);
    }
  }

  return (2 * hits) / (a.length + b.length - 2);
}

export function scoreNameAgainstText(
  name: unknown,
  normalizedText: string,
  textTokens: Iterable<string>
): number {
  const normalizedName = normalizeText(name);
  if (!normalizedName) {
    return 0;
  }

  if (normalizedText.includes(normalizedName)) {
    return 1;
  }

  const nameTokens = significantNameTokens(name);
  if (nameTokens.length === 0) {
    return 0;
  }

  const textTokenSet = new Set(textTokens);
  const hits = nameTokens.filter((token) => textTokenSet.has(token)).length;
  const hitRate = hits / nameTokens.length;
  let score = hitRate >= 1 ? 0.92 : hitRate >= 0.67 ? 0.84 : hitRate >= 0.5 ? 0.72 : hitRate * 0.65;

  const lastToken = nameTokens.at(-1);
  if (lastToken && textTokenSet.has(lastToken)) {
    score = Math.max(score, nameTokens.length === 1 ? 0.9 : 0.74);
  }

  const acronym = nameTokens.map((token) => token[0]).join('');
  if (acronym.length >= 2 && textTokenSet.has(acronym)) {
    score = Math.max(score, 0.78);
  }

  score = Math.max(score, bestTokenWindowSimilarity(nameTokens, [...textTokenSet]));
  return clamp(score, 0, 1);
}

export function bestTokenWindowSimilarity(nameTokens: string[], textTokens: string[]): number {
  if (nameTokens.length === 0 || textTokens.length === 0) {
    return 0;
  }

  const nameText = nameTokens.join(' ');
  const minWindow = Math.max(1, nameTokens.length - 1);
  const maxWindow = Math.min(textTokens.length, nameTokens.length + 1);
  let best = 0;

  for (let size = minWindow; size <= maxWindow; size += 1) {
    for (let start = 0; start + size <= textTokens.length; start += 1) {
      const windowText = textTokens.slice(start, start + size).join(' ');
      best = Math.max(best, diceCoefficient(nameText, windowText));
    }
  }

  return best >= 0.88 ? best : best * 0.82;
}

export function extractNumbers(input: unknown): number[] {
  const text = String(input ?? '');
  const matches = text.matchAll(/(^|[^a-z0-9])([+-]?\d+(?:\.\d+)?)(?![a-z0-9])/gi);
  const values: number[] = [];

  for (const match of matches) {
    const value = Number(match[2]);
    if (Number.isFinite(value)) {
      values.push(value);
    }
  }

  return values;
}

export function parseDateLike(input: unknown): Date | undefined {
  if (input instanceof Date && Number.isFinite(input.getTime())) {
    return input;
  }

  if (typeof input === 'number' && Number.isFinite(input)) {
    const millis = input > 10_000_000_000 ? input : input * 1000;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date : undefined;
  }

  if (typeof input === 'string' && input.trim()) {
    const numeric = Number(input);
    if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(input.trim())) {
      return parseDateLike(numeric);
    }

    const date = new Date(input);
    return Number.isFinite(date.getTime()) ? date : undefined;
  }

  return undefined;
}

export function hoursBetween(left: Date, right: Date): number {
  return Math.abs(left.getTime() - right.getTime()) / 3_600_000;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
