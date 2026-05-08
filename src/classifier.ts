import type { MarketType, PolymarketMarket, SxMarket } from './types';
import { extractNumbers, normalizeText } from './normalization';

const OVER_UNDER_WORDS = /\b(over|under|o\/u|ou)\b/i;
const TOTAL_WORDS = /\b(over|under|o\/u|ou|total|totals|points|goals|runs|rounds|maps|sets)\b/i;
const SPREAD_WORDS = /\b(spread|handicap|cover|covers|puck line|run line|game line|point line)\b/i;
const PLAYER_WORDS = /\b(player|goalscorers?|passing|rushing|receiving|rebounds?|assists?|points scored|shots?|saves?)\b/i;
const MONEYLINE_WORDS = /\b(moneyline|to win|who will win|winner|beat|defeat|advance|qualify)\b/i;
const UNSUPPORTED_POLYMARKET_WORDS =
  /\b(both teams to score|btts|correct score|exact score|double chance|draw no bet|clean sheet|first team to score|last team to score|winning margin|run scored in the first inning|runs? scored in the 1st inning|first blood|toss|completed match|team top batter|most sixes|odd\/even|odd even|destroy inhibitors?|slay (?:a )?dragon|slay baron|ko or tko|ko\/tko|submission|go the distance|inside the distance|win by decision|goes? to day)\b/i;
const HEAD_TO_HEAD_PROP_WORDS =
  /\b(over|under|o\/u|ou|total|totals|spread|handicap|cover|covers|score|points?|goals?|runs?|rounds?|maps?|sets?|rebounds?|assists?|shots?|saves?)\b/i;

export function buildPolymarketText(market: PolymarketMarket): string {
  return [
    market.question,
    market.marketSlug,
    market.description,
    market.tags,
    stringifyTokenNames(market.tokens)
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildSxText(market: SxMarket): string {
  return [
    market.sport_label,
    market.league_label,
    market.team_one_name,
    market.team_two_name,
    market.outcome_one_name,
    market.outcome_two_name,
    market.outcome_void_name,
    market.group1,
    market.group2,
    market.market_type,
    market.line
  ]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .join(' ');
}

export function inferPolymarketMarketType(market: PolymarketMarket): MarketType {
  const text = buildPolymarketText(market);
  const primaryText = buildPolymarketPrimaryText(market);

  if (UNSUPPORTED_POLYMARKET_WORDS.test(primaryText) || UNSUPPORTED_POLYMARKET_WORDS.test(text)) {
    return 'unsupported';
  }

  if (SPREAD_WORDS.test(primaryText) || SPREAD_WORDS.test(text)) {
    return 'spread';
  }

  if (OVER_UNDER_WORDS.test(primaryText) && extractLineCandidates(primaryText).length > 0) {
    return 'total';
  }

  if (TOTAL_WORDS.test(primaryText) && OVER_UNDER_WORDS.test(primaryText)) {
    return 'total';
  }

  if (/\b(champion|championship|tournament winner|league winner|division winner)\b/i.test(primaryText)) {
    return 'outright';
  }

  if (MONEYLINE_WORDS.test(primaryText) || looksLikeHeadToHeadPolymarketMarket(market)) {
    return 'moneyline';
  }

  if (PLAYER_WORDS.test(primaryText) || PLAYER_WORDS.test(text)) {
    return 'player_prop';
  }

  if (OVER_UNDER_WORDS.test(text) && extractLineCandidates(text).length > 0) {
    return 'total';
  }

  if (TOTAL_WORDS.test(text) && OVER_UNDER_WORDS.test(text)) {
    return 'total';
  }

  if (MONEYLINE_WORDS.test(text)) {
    return 'moneyline';
  }

  return 'unknown';
}

export function inferSxMarketType(market: SxMarket): MarketType {
  const text = buildSxText(market);
  const normalizedOutcomeOne = normalizeText(market.outcome_one_name);
  const normalizedOutcomeTwo = normalizeText(market.outcome_two_name);
  const normalizedTeamOne = normalizeText(market.team_one_name);
  const normalizedTeamTwo = normalizeText(market.team_two_name);
  const hasLine = toOptionalNumber(market.line) !== undefined;
  const hasTeamLineOutcomes =
    hasLine &&
    normalizedOutcomeOne &&
    normalizedOutcomeTwo &&
    normalizedTeamOne &&
    normalizedTeamTwo &&
    (normalizedOutcomeOne.includes(normalizedTeamOne) || normalizedTeamOne.includes(normalizedOutcomeOne)) &&
    (normalizedOutcomeTwo.includes(normalizedTeamTwo) || normalizedTeamTwo.includes(normalizedOutcomeTwo));

  if (PLAYER_WORDS.test(text)) {
    return 'player_prop';
  }

  if (SPREAD_WORDS.test(text) || hasTeamLineOutcomes) {
    return 'spread';
  }

  if (
    normalizedOutcomeOne === 'over' ||
    normalizedOutcomeTwo === 'under' ||
    OVER_UNDER_WORDS.test(`${market.outcome_one_name ?? ''} ${market.outcome_two_name ?? ''}`) ||
    (TOTAL_WORDS.test(text) && hasLine)
  ) {
    return 'total';
  }

  if (!hasLine && normalizedTeamOne && normalizedTeamTwo) {
    return 'moneyline';
  }

  return 'unknown';
}

export function extractPolymarketLine(market: PolymarketMarket, marketType: MarketType): number | undefined {
  if (!['spread', 'total', 'player_prop', 'team_prop'].includes(marketType)) {
    return undefined;
  }

  const primaryLine = extractPrimaryPolymarketLine(market, marketType);
  if (primaryLine !== undefined) {
    return primaryLine;
  }

  const candidates = extractLineCandidates(buildPolymarketText(market));
  if (candidates.length === 0) {
    return undefined;
  }

  const plausible = candidates.filter((value) => Math.abs(value) < 1000 && Math.abs(value) !== 0);
  return plausible[0] ?? candidates[0];
}

export function extractSxLine(market: SxMarket): number | undefined {
  return toOptionalNumber(market.line);
}

export function typesAreCompatible(left: MarketType, right: MarketType): boolean {
  if (left === 'unsupported' || right === 'unsupported') {
    return false;
  }

  if (left === 'unknown' || right === 'unknown') {
    return true;
  }

  if (left === right) {
    return true;
  }

  return (
    (left === 'team_prop' && right === 'player_prop') ||
    (left === 'player_prop' && right === 'team_prop')
  );
}

export function typeScore(left: MarketType, right: MarketType): number {
  if (left === right && left !== 'unknown') {
    return 1;
  }

  if (left === 'unknown' || right === 'unknown') {
    return 0.62;
  }

  return typesAreCompatible(left, right) ? 0.72 : 0;
}

function extractLineCandidates(text: string): number[] {
  const normalized = text.replace(/(\d),(\d)/g, '$1$2');
  const numbers = extractNumbers(normalized);

  return numbers.filter((value) => {
    const abs = Math.abs(value);
    return abs < 1000 && !Number.isInteger(value) ? true : abs <= 400;
  });
}

function extractPrimaryPolymarketLine(market: PolymarketMarket, marketType: MarketType): number | undefined {
  const primaryText = buildPolymarketPrimaryText(market);

  if (marketType === 'spread') {
    const parenthesizedSigned = primaryText.match(/\(([+-]\s*\d+(?:\.\d+)?)\)/);
    if (parenthesizedSigned?.[1]) {
      return Number(parenthesizedSigned[1].replace(/\s+/g, ''));
    }

    const signed = primaryText.match(/(^|[^a-z0-9])([+-]\s*\d+(?:\.\d+)?)(?![a-z0-9])/i);
    if (signed?.[2]) {
      return Number(signed[2].replace(/\s+/g, ''));
    }
  }

  if (marketType === 'total') {
    const total = primaryText.match(/\b(?:o\/u|ou|over|under)\s*([+-]?\d+(?:\.\d+)?)/i);
    if (total?.[1]) {
      return Number(total[1]);
    }
  }

  return undefined;
}

function buildPolymarketPrimaryText(market: PolymarketMarket): string {
  return [market.question, market.marketSlug].filter(Boolean).join(' ');
}

function looksLikeHeadToHeadPolymarketMarket(market: PolymarketMarket): boolean {
  const question = normalizeText(market.question);
  if (!question || HEAD_TO_HEAD_PROP_WORDS.test(question)) {
    return false;
  }

  return /\b(v|vs|versus)\b/.test(question);
}

function stringifyTokenNames(tokens: unknown): string {
  if (!tokens) {
    return '';
  }

  if (typeof tokens === 'string') {
    return tokens;
  }

  if (Array.isArray(tokens)) {
    return tokens
      .map((token) => {
        if (typeof token === 'string') {
          return token;
        }

        if (token && typeof token === 'object') {
          const record = token as Record<string, unknown>;
          return [record.outcome, record.name, record.token_id, record.tokenId].filter(Boolean).join(' ');
        }

        return '';
      })
      .join(' ');
  }

  return '';
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}
