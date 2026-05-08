import {
  buildPolymarketText,
  buildSxText,
  extractPolymarketLine,
  extractSxLine,
  inferPolymarketMarketType,
  inferSxMarketType,
  typeScore,
  typesAreCompatible
} from './classifier';
import {
  clamp,
  diceCoefficient,
  hoursBetween,
  jaccard,
  normalizeText,
  parseDateLike,
  roundScore,
  scoreNameAgainstText,
  tokenize,
  uniqueTokens
} from './normalization';
import { buildOutcomeTokenMapping } from './tokenMapping';
import type {
  CandidateMatch,
  MatchComponentScores,
  MatchConfidence,
  MatchOptions,
  MatchReasons,
  NormalizedPolymarketMarket,
  NormalizedSxMarket,
  PolymarketMarket,
  SxMarket
} from './types';

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  minScore: 0.78,
  reviewScore: 0.66,
  ambiguityGap: 0.03,
  maxTimeDeltaHours: 36,
  lineTolerance: 0.05,
  minEventScore: 0.54,
  maxCandidatesPerPolymarket: 12
};

export function normalizePolymarketMarket(market: PolymarketMarket): NormalizedPolymarketMarket {
  const text = buildPolymarketText(market);
  const tokens = uniqueTokens(tokenize(text));
  const marketType = inferPolymarketMarketType(market);

  return {
    source: 'polymarket',
    id: market.conditionId,
    raw: market,
    text,
    normalizedText: normalizeText(text),
    tokens,
    tokenSet: new Set(tokens),
    eventTime: parseDateLike(market.gameStartTime) ?? parseDateLike(market.endDateIso),
    marketType,
    line: extractPolymarketLine(market, marketType)
  };
}

export function normalizeSxMarket(market: SxMarket): NormalizedSxMarket {
  const text = buildSxText(market);
  const tokens = uniqueTokens(tokenize(text));
  const marketType = inferSxMarketType(market);
  const teamNames = [market.team_one_name, market.team_two_name].filter(
    (name): name is string => Boolean(name && name.trim())
  );

  return {
    source: 'sx',
    id: market.market_hash,
    raw: market,
    text,
    normalizedText: normalizeText(text),
    tokens,
    tokenSet: new Set(tokens),
    eventTime: parseDateLike(market.game_time_at) ?? parseDateLike(market.game_time),
    marketType,
    line: extractSxLine(market),
    teamNames,
    sportLabel: market.sport_label ?? undefined,
    leagueLabel: market.league_label ?? undefined
  };
}

export function scorePair(
  polymarket: NormalizedPolymarketMarket,
  sx: NormalizedSxMarket,
  options: MatchOptions = DEFAULT_MATCH_OPTIONS
): CandidateMatch | undefined {
  if (!typesAreCompatible(polymarket.marketType, sx.marketType)) {
    return undefined;
  }

  const time = scoreTime(polymarket.eventTime, sx.eventTime, options.maxTimeDeltaHours);
  if (time.rejected) {
    return undefined;
  }

  const event = scoreEvent(polymarket, sx);
  const text = scoreText(polymarket, sx);
  if (event.score < options.minEventScore && text < 0.45) {
    return undefined;
  }

  const marketType = typeScore(polymarket.marketType, sx.marketType);
  if (marketType <= 0) {
    return undefined;
  }

  const line = scoreLine(polymarket.line, sx.line, polymarket.marketType, sx.marketType, options.lineTolerance);
  if (line.rejected) {
    return undefined;
  }

  const league = scoreLeague(polymarket, sx);
  const componentScores: MatchComponentScores = {
    event: roundScore(event.score),
    time: roundScore(time.score),
    marketType: roundScore(marketType),
    line: roundScore(line.score),
    league: roundScore(league),
    text: roundScore(text)
  };

  const score = roundScore(
    componentScores.event * 0.4 +
      componentScores.marketType * 0.18 +
      componentScores.line * 0.16 +
      componentScores.time * 0.14 +
      componentScores.league * 0.07 +
      componentScores.text * 0.05
  );

  const reasons: MatchReasons = {
    summary: buildSummary(componentScores, polymarket, sx, time.deltaHours),
    teamScores: event.teamScores,
    timeDeltaHours: time.deltaHours === undefined ? undefined : roundScore(time.deltaHours),
    polymarketMarketType: polymarket.marketType,
    sxMarketType: sx.marketType,
    polymarketLine: polymarket.line,
    sxLine: sx.line,
    tokenMapping: buildOutcomeTokenMapping(polymarket.raw, sx.raw, {
      homeTeam: sx.raw.team_one_name ?? undefined,
      awayTeam: sx.raw.team_two_name ?? undefined,
      rawHomeTeam: sx.raw.team_one_name ?? undefined,
      rawAwayTeam: sx.raw.team_two_name ?? undefined
    })
  };

  return {
    polymarket: polymarket.raw,
    sx: sx.raw,
    polymarketId: polymarket.id,
    sxMarketHash: sx.id,
    score,
    confidence: confidenceForScore(score),
    status: score >= options.minScore ? 'matched' : 'needs_review',
    componentScores,
    reasons
  };
}

export function confidenceForScore(score: number): MatchConfidence {
  if (score >= 0.9) {
    return 'high';
  }

  if (score >= 0.8) {
    return 'medium';
  }

  if (score >= 0.66) {
    return 'review';
  }

  return 'low';
}

function scoreEvent(
  polymarket: NormalizedPolymarketMarket,
  sx: NormalizedSxMarket
): { score: number; teamScores: Array<{ team: string; score: number }> } {
  const teamScores = sx.teamNames.map((team) => ({
    team,
    score: roundScore(scoreNameAgainstText(team, polymarket.normalizedText, polymarket.tokens))
  }));

  if (teamScores.length === 0) {
    return {
      score: clamp(scoreText(polymarket, sx), 0, 0.65),
      teamScores
    };
  }

  const scores = teamScores.map((entry) => entry.score);
  const best = Math.max(...scores);
  const worst = Math.min(...scores);

  if (scores.length === 1) {
    return { score: best, teamScores };
  }

  if (best >= 0.82 && worst < 0.35) {
    return { score: 0.62, teamScores };
  }

  return {
    score: clamp((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 0.72 + worst * 0.28, 0, 1),
    teamScores
  };
}

function scoreTime(
  polymarketTime: Date | undefined,
  sxTime: Date | undefined,
  maxTimeDeltaHours: number
): { score: number; deltaHours?: number; rejected: boolean } {
  if (!polymarketTime || !sxTime) {
    return { score: 0.52, rejected: false };
  }

  const deltaHours = hoursBetween(polymarketTime, sxTime);
  if (deltaHours > maxTimeDeltaHours) {
    return { score: 0, deltaHours, rejected: true };
  }

  if (deltaHours <= 1) {
    return { score: 1, deltaHours, rejected: false };
  }

  if (deltaHours <= 3) {
    return { score: 0.94, deltaHours, rejected: false };
  }

  if (deltaHours <= 6) {
    return { score: 0.82, deltaHours, rejected: false };
  }

  if (deltaHours <= 12) {
    return { score: 0.68, deltaHours, rejected: false };
  }

  return { score: 0.46, deltaHours, rejected: false };
}

function scoreLine(
  polymarketLine: number | undefined,
  sxLine: number | undefined,
  polymarketType: string,
  sxType: string,
  tolerance: number
): { score: number; rejected: boolean } {
  const lineSensitive = ['spread', 'total', 'player_prop', 'team_prop'].includes(polymarketType) ||
    ['spread', 'total', 'player_prop', 'team_prop'].includes(sxType);

  if (polymarketLine === undefined && sxLine === undefined) {
    return { score: 0.82, rejected: false };
  }

  if (polymarketLine === undefined || sxLine === undefined) {
    return { score: lineSensitive ? 0.42 : 0.66, rejected: false };
  }

  const diff =
    polymarketType === 'spread' || sxType === 'spread'
      ? Math.abs(Math.abs(polymarketLine) - Math.abs(sxLine))
      : Math.abs(polymarketLine - sxLine);

  if (diff <= tolerance) {
    return { score: 1, rejected: false };
  }

  return { score: lineSensitive ? 0.08 : 0.35, rejected: lineSensitive };
}

function scoreLeague(polymarket: NormalizedPolymarketMarket, sx: NormalizedSxMarket): number {
  const leagueScore = sx.leagueLabel
    ? scoreNameAgainstText(sx.leagueLabel, polymarket.normalizedText, polymarket.tokens)
    : 0;
  const sportScore = sx.sportLabel
    ? scoreNameAgainstText(sx.sportLabel, polymarket.normalizedText, polymarket.tokens)
    : 0;

  if (leagueScore > 0 || sportScore > 0) {
    return Math.max(leagueScore, sportScore * 0.85);
  }

  return polymarket.raw.isSport ? 0.58 : 0.38;
}

function scoreText(polymarket: NormalizedPolymarketMarket, sx: NormalizedSxMarket): number {
  const tokenScore = jaccard(polymarket.tokenSet, sx.tokenSet);
  const diceScore = diceCoefficient(polymarket.normalizedText, sx.normalizedText);
  return clamp(tokenScore * 0.65 + diceScore * 0.35, 0, 1);
}

function buildSummary(
  components: MatchComponentScores,
  polymarket: NormalizedPolymarketMarket,
  sx: NormalizedSxMarket,
  deltaHours?: number
): string[] {
  const summary: string[] = [];

  if (components.event >= 0.85) {
    summary.push('both SX teams are present in the Polymarket text');
  } else if (components.event >= 0.6) {
    summary.push('one SX team strongly matches the Polymarket text');
  }

  if (deltaHours !== undefined) {
    summary.push(`event times differ by ${roundScore(deltaHours)}h`);
  }

  if (polymarket.marketType === sx.marketType && polymarket.marketType !== 'unknown') {
    summary.push(`market type matches as ${polymarket.marketType}`);
  }

  if (polymarket.line !== undefined && sx.line !== undefined && components.line >= 0.99) {
    summary.push(`line matches at ${sx.line}`);
  }

  return summary;
}
