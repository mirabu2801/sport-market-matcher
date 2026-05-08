import {
  diceCoefficient,
  normalizeText,
  roundScore,
  scoreNameAgainstText,
  tokenize
} from './normalization';
import { teamSearchNames } from './teamAliases';
import type {
  CanonicalBetType,
  CanonicalSide,
  OutcomeTokenMapping,
  OutcomeTokenMappingEntry,
  PolymarketMarket,
  PolymarketOutcomeToken,
  SxMarket
} from './types';

export interface OutcomeTokenMappingContext {
  polymarketSide?: CanonicalSide;
  sxSide?: CanonicalSide;
  sxBetType?: CanonicalBetType;
  homeTeam?: string;
  awayTeam?: string;
  rawHomeTeam?: string;
  rawAwayTeam?: string;
}

interface SxOutcomeSlot {
  index: 0 | 1;
  sxToken: 'sx_token0' | 'sx_token1';
  outcome: string;
  side: CanonicalSide;
}

interface PairScore {
  pm: PolymarketOutcomeToken;
  slot: SxOutcomeSlot;
  score: number;
  method: OutcomeTokenMappingEntry['method'];
  pmSide: CanonicalSide;
  sxSide: CanonicalSide;
}

const MIN_TOKEN_MAPPING_SCORE = 0.62;

export function buildOutcomeTokenMapping(
  polymarket: PolymarketMarket,
  sx: SxMarket,
  context: OutcomeTokenMappingContext = {}
): OutcomeTokenMapping | undefined {
  const pmTokens = extractPolymarketOutcomeTokens(polymarket.tokens);
  const sxSlots = sxOutcomeSlots(sx, context);

  if (pmTokens.length === 0 || sxSlots.length === 0) {
    return undefined;
  }

  const entries = chooseAssignments(sxSlots, pmTokens, context);
  if (entries.length === 0) {
    return undefined;
  }

  const mapping: OutcomeTokenMapping = {
    summary: entries
      .filter((entry) => entry.method !== 'unmatched' && entry.pmToken)
      .map((entry) => `${entry.pmToken}=${entry.sxToken}`)
  };

  for (const entry of entries) {
    if (entry.sxTokenIndex === 0) {
      mapping.sxToken0 = entry;
    } else {
      mapping.sxToken1 = entry;
    }
  }

  return mapping;
}

export function extractPolymarketOutcomeTokens(tokens: unknown): PolymarketOutcomeToken[] {
  const parsed = parseMaybeJson(tokens);
  const values = Array.isArray(parsed) ? parsed : extractNestedTokenArray(parsed);
  if (!values) {
    return [];
  }

  const outcomeTokens: PolymarketOutcomeToken[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const token = parsePolymarketToken(value, index);
    if (token) {
      outcomeTokens.push(token);
    }
  }

  return outcomeTokens;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function extractNestedTokenArray(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['tokens', 'outcomes', 'clobTokens']) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      return nested;
    }
  }

  return undefined;
}

function parsePolymarketToken(value: unknown, index: number): PolymarketOutcomeToken | undefined {
  if (typeof value === 'string') {
    const outcome = value.trim();
    return outcome ? { index, pmToken: `pm_token${index}`, outcome } : undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const outcome = firstString(record.outcome, record.name, record.title, record.label);
  if (!outcome) {
    return undefined;
  }

  const tokenId = firstString(record.token_id, record.tokenId, record.id, record.clobTokenId);
  return {
    index,
    pmToken: `pm_token${index}`,
    tokenId,
    outcome
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
  }

  return undefined;
}

function sxOutcomeSlots(sx: SxMarket, context: OutcomeTokenMappingContext): SxOutcomeSlot[] {
  const rawSlots: Array<{ index: 0 | 1; sxToken: 'sx_token0' | 'sx_token1'; outcome?: string | null }> = [
    { index: 0, sxToken: 'sx_token0', outcome: sx.outcome_one_name },
    { index: 1, sxToken: 'sx_token1', outcome: sx.outcome_two_name }
  ];

  const slots = rawSlots
    .filter((slot): slot is { index: 0 | 1; sxToken: 'sx_token0' | 'sx_token1'; outcome: string } =>
      Boolean(slot.outcome?.trim())
    )
    .map((slot) => ({
      ...slot,
      outcome: slot.outcome.trim(),
      side: inferSxSlotSide(slot.index, slot.outcome, context)
    }));

  return slots;
}

function chooseAssignments(
  slots: SxOutcomeSlot[],
  pmTokens: PolymarketOutcomeToken[],
  context: OutcomeTokenMappingContext
): OutcomeTokenMappingEntry[] {
  if (slots.length === 1) {
    return [entryForBestPair(slots[0]!, pmTokens, context, new Set())];
  }

  if (slots.length >= 2 && pmTokens.length >= 2) {
    const firstSlot = slots[0]!;
    const secondSlot = slots[1]!;
    let best: [PairScore, PairScore] | undefined;
    let bestTotal = -1;

    for (const firstPm of pmTokens) {
      for (const secondPm of pmTokens) {
        if (firstPm.index === secondPm.index) {
          continue;
        }

        const firstScore = scorePair(firstSlot, firstPm, context);
        const secondScore = scorePair(secondSlot, secondPm, context);
        const total = viableAssignmentScore(firstScore) + viableAssignmentScore(secondScore);
        if (total > bestTotal) {
          bestTotal = total;
          best = [firstScore, secondScore];
        }
      }
    }

    if (best) {
      return best.map((pair) => entryFromPair(pair));
    }
  }

  const usedPmIndexes = new Set<number>();
  return slots.map((slot) => entryForBestPair(slot, pmTokens, context, usedPmIndexes));
}

function entryForBestPair(
  slot: SxOutcomeSlot,
  pmTokens: PolymarketOutcomeToken[],
  context: OutcomeTokenMappingContext,
  usedPmIndexes: Set<number>
): OutcomeTokenMappingEntry {
  let best: PairScore | undefined;
  for (const pm of pmTokens) {
    if (usedPmIndexes.has(pm.index)) {
      continue;
    }

    const pair = scorePair(slot, pm, context);
    if (!best || pair.score > best.score) {
      best = pair;
    }
  }

  const entry = best ? entryFromPair(best) : unmatchedEntry(slot, 0);
  if (entry.pmTokenIndex !== undefined) {
    usedPmIndexes.add(entry.pmTokenIndex);
  }
  return entry;
}

function viableAssignmentScore(pair: PairScore): number {
  return pair.score >= MIN_TOKEN_MAPPING_SCORE ? pair.score : pair.score * 0.25;
}

function scorePair(
  slot: SxOutcomeSlot,
  pm: PolymarketOutcomeToken,
  context: OutcomeTokenMappingContext
): PairScore {
  const pmSide = inferPmTokenSide(pm.outcome, context);
  const sxSide = slot.side;
  const sharedTeamSide = sharedTeamSideForOutcomes(pm.outcome, slot.outcome, context);
  const sideScore = sidesAreEquivalent(pmSide, sxSide) || sharedTeamSide !== undefined ? 1 : 0;
  const textScore = scoreOutcomeText(pm.outcome, slot.outcome);
  const score = roundScore(Math.max(textScore, sideScore));
  const method = tokenMappingMethod(sideScore > 0, textScore >= MIN_TOKEN_MAPPING_SCORE, score);

  return {
    pm,
    slot,
    score,
    method,
    pmSide: pmSide === 'unknown' && sharedTeamSide ? sharedTeamSide : pmSide,
    sxSide
  };
}

function tokenMappingMethod(
  sideMatched: boolean,
  textMatched: boolean,
  score: number
): OutcomeTokenMappingEntry['method'] {
  if (score < MIN_TOKEN_MAPPING_SCORE) {
    return 'unmatched';
  }
  if (sideMatched && textMatched) {
    return 'side+text';
  }
  if (sideMatched) {
    return 'side';
  }
  return 'text';
}

function entryFromPair(pair: PairScore): OutcomeTokenMappingEntry {
  if (pair.score < MIN_TOKEN_MAPPING_SCORE) {
    return unmatchedEntry(pair.slot, pair.score, pair.sxSide);
  }

  return {
    sxToken: pair.slot.sxToken,
    sxTokenIndex: pair.slot.index,
    sxOutcome: pair.slot.outcome,
    pmToken: pair.pm.pmToken,
    pmTokenIndex: pair.pm.index,
    pmTokenId: pair.pm.tokenId,
    pmOutcome: pair.pm.outcome,
    score: pair.score,
    method: pair.method,
    sxSide: pair.sxSide,
    pmSide: pair.pmSide
  };
}

function unmatchedEntry(
  slot: SxOutcomeSlot,
  score: number,
  side = slot.side
): OutcomeTokenMappingEntry {
  return {
    sxToken: slot.sxToken,
    sxTokenIndex: slot.index,
    sxOutcome: slot.outcome,
    score: roundScore(score),
    method: 'unmatched',
    sxSide: side
  };
}

function scoreOutcomeText(pmOutcome: string, sxOutcome: string): number {
  const pmText = normalizeText(pmOutcome);
  const sxText = normalizeText(sxOutcome);
  if (!pmText || !sxText) {
    return 0;
  }

  if (pmText === sxText) {
    return 1;
  }

  const pmToSx = scoreNameAgainstText(pmOutcome, sxText, tokenize(sxOutcome));
  const sxToPm = scoreNameAgainstText(sxOutcome, pmText, tokenize(pmOutcome));
  const dice = diceCoefficient(pmOutcome, sxOutcome);
  return roundScore(Math.max(pmToSx, sxToPm, dice));
}

function inferPmTokenSide(outcome: string, context: OutcomeTokenMappingContext): CanonicalSide {
  const text = normalizeText(outcome);
  if (text === 'yes') {
    return context.polymarketSide ?? 'unknown';
  }
  if (text === 'no') {
    return oppositeSide(context.polymarketSide, context.sxBetType);
  }

  return inferSideFromText(outcome, context);
}

function inferSxSlotSide(
  index: 0 | 1,
  outcome: string,
  context: OutcomeTokenMappingContext
): CanonicalSide {
  const textSide = inferSideFromText(outcome, context);
  if (textSide !== 'unknown') {
    return textSide;
  }

  if (index === 0 && context.sxSide) {
    return context.sxSide;
  }

  if (index === 1 && context.sxSide) {
    return oppositeSide(context.sxSide, context.sxBetType);
  }

  return 'unknown';
}

function inferSideFromText(label: string, context: OutcomeTokenMappingContext): CanonicalSide {
  const text = normalizeText(label);
  if (!text) {
    return 'unknown';
  }

  const negated = text.startsWith('not ');
  if (/\b(draw|tie)\b/.test(text)) {
    return negated ? 'not_draw' : 'draw';
  }
  if (/^over\b/.test(text)) {
    return 'over';
  }
  if (/^under\b/.test(text)) {
    return 'under';
  }

  const homeScore = scoreTeamSide(label, context.rawHomeTeam, context.homeTeam);
  const awayScore = scoreTeamSide(label, context.rawAwayTeam, context.awayTeam);
  if (homeScore >= 0.68 && homeScore > awayScore + 0.08) {
    return negated ? 'not_home' : 'home';
  }
  if (awayScore >= 0.68 && awayScore > homeScore + 0.08) {
    return negated ? 'not_away' : 'away';
  }

  return 'unknown';
}

function scoreTeamSide(label: string, rawTeam?: string, canonicalTeam?: string): number {
  const names = teamNames(rawTeam, canonicalTeam);
  if (names.length === 0) {
    return 0;
  }

  const normalizedLabel = normalizeText(label);
  const labelTokens = tokenize(label);
  let best = 0;
  for (const name of names) {
    const normalizedName = normalizeText(name);
    const nameTokenCount = tokenize(name).length;
    const score = scoreNameAgainstText(name, normalizedLabel, labelTokens);
    const adjustedScore =
      nameTokenCount === 1 && normalizedName !== normalizedLabel ? Math.min(score, 0.6) : score;
    best = Math.max(best, adjustedScore);
  }

  return best;
}

function sharedTeamSideForOutcomes(
  pmOutcome: string,
  sxOutcome: string,
  context: OutcomeTokenMappingContext
): CanonicalSide | undefined {
  const pm = strongestTeamSide(pmOutcome, context);
  const sx = strongestTeamSide(sxOutcome, context);
  if (!pm || !sx || pm.side !== sx.side) {
    return undefined;
  }

  return pm.side;
}

function strongestTeamSide(
  label: string,
  context: OutcomeTokenMappingContext
): { side: CanonicalSide; score: number } | undefined {
  const homeScore = scoreTeamSide(label, context.rawHomeTeam, context.homeTeam);
  const awayScore = scoreTeamSide(label, context.rawAwayTeam, context.awayTeam);
  const best = Math.max(homeScore, awayScore);
  const margin = Math.abs(homeScore - awayScore);
  if (best < 0.62 || margin < 0.08) {
    return undefined;
  }

  return homeScore > awayScore ? { side: 'home', score: homeScore } : { side: 'away', score: awayScore };
}

function teamNames(rawTeam?: string, canonicalTeam?: string): string[] {
  if (rawTeam && canonicalTeam) {
    return teamSearchNames(rawTeam, canonicalTeam);
  }
  if (rawTeam) {
    return teamSearchNames(rawTeam);
  }
  if (canonicalTeam) {
    return teamSearchNames(canonicalTeam);
  }
  return [];
}

function sidesAreEquivalent(left: CanonicalSide, right: CanonicalSide): boolean {
  return left !== 'unknown' && right !== 'unknown' && left === right;
}

function oppositeSide(side: CanonicalSide | undefined, betType: CanonicalBetType | undefined): CanonicalSide {
  switch (side) {
    case 'home':
      return betType === '1x2' ? 'not_home' : 'away';
    case 'away':
      return betType === '1x2' ? 'not_away' : 'home';
    case 'draw':
      return 'not_draw';
    case 'not_home':
      return 'home';
    case 'not_away':
      return 'away';
    case 'not_draw':
      return 'draw';
    case 'over':
      return 'under';
    case 'under':
      return 'over';
    default:
      return 'unknown';
  }
}
