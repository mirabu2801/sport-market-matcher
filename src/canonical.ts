import {
  buildPolymarketText,
  buildSxText,
  extractPolymarketLine,
  extractSxLine,
  inferPolymarketMarketType,
  inferSxMarketType
} from './classifier';
import {
  clamp,
  diceCoefficient,
  hoursBetween,
  normalizeText,
  parseDateLike,
  roundScore,
  scoreNameAgainstText,
  significantNameTokens,
  tokenize
} from './normalization';
import { canonicalTeamName, canonicalTeamPairKey, teamSearchNames } from './teamAliases';
import { buildOutcomeTokenMapping } from './tokenMapping';
import { confidenceForScore } from './scoring';
import type {
  CandidateMatch,
  CanonicalBetType,
  CanonicalSide,
  MatchComponentScores,
  MatchOptions,
  MatchReasons,
  NormalizedPolymarketMarket,
  NormalizedSxMarket,
  PolymarketMarket,
  SxMarket
} from './types';

export interface CanonicalSxMarket {
  source: 'sx';
  raw: SxMarket;
  id: string;
  sport?: string;
  league?: string;
  eventId?: string;
  eventTime?: Date;
  homeTeam: string;
  awayTeam: string;
  rawHomeTeam: string;
  rawAwayTeam: string;
  teamPairKey: string;
  betType: CanonicalBetType;
  marketKey: string;
  side: CanonicalSide;
  segment: CanonicalSegment;
  line?: number;
}

interface CanonicalPolymarketIntent {
  betType: CanonicalBetType;
  marketKey: string;
  side: CanonicalSide;
  segment: CanonicalSegment;
  line?: number;
  explicitSingleTeamWin: boolean;
}

type CanonicalSegment =
  | 'full'
  | 'half1'
  | 'half2'
  | 'period1'
  | 'period2'
  | 'period3'
  | 'period4'
  | 'quarter1'
  | 'quarter2'
  | 'quarter3'
  | 'quarter4'
  | 'game1'
  | 'game2'
  | 'game3'
  | 'game4'
  | 'game5'
  | 'unknown';

interface TeamHit {
  team: string;
  score: number;
  firstPosition: number;
}

const SX_12_TYPES = new Set([52, 226]);
const SX_SPREAD_TYPES = new Set([3, 342, 866]);
const SX_TOTAL_TYPES = new Set([2, 28]);
const GENERIC_TEAM_IDENTITY_TOKENS = new Set([
  'a',
  'ac',
  'afc',
  'as',
  'ca',
  'cd',
  'cf',
  'club',
  'cs',
  'ec',
  'fc',
  'sc',
  'se',
  'team'
]);

export function canonicalizeSxMarket(market: SxMarket): CanonicalSxMarket | undefined {
  const rawHomeTeam = market.team_one_name?.trim();
  const rawAwayTeam = market.team_two_name?.trim();
  if (!rawHomeTeam || !rawAwayTeam) {
    return undefined;
  }

  const homeTeam = canonicalTeamName(rawHomeTeam);
  const awayTeam = canonicalTeamName(rawAwayTeam);
  const betType = inferSxCanonicalBetType(market, homeTeam, awayTeam);
  const side = inferSxOutcomeSide(market, homeTeam, awayTeam);
  const segment = inferSxSegment(market);
  const line = extractSxLine(market);
  const marketKey = sxMarketKey(betType, side, line);

  return {
    source: 'sx',
    raw: market,
    id: market.market_hash,
    sport: market.sport_label ?? undefined,
    league: market.league_label ?? undefined,
    eventId: market.sport_x_event_id ?? undefined,
    eventTime: parseDateLike(market.game_time_at) ?? parseDateLike(market.game_time),
    homeTeam,
    awayTeam,
    rawHomeTeam,
    rawAwayTeam,
    teamPairKey: canonicalTeamPairKey(homeTeam, awayTeam),
    betType,
    marketKey,
    side,
    segment,
    line
  };
}

export function scoreCanonicalPair(
  polymarket: NormalizedPolymarketMarket,
  sx: NormalizedSxMarket,
  canonicalSx: CanonicalSxMarket,
  options: MatchOptions
): CandidateMatch | undefined {
  if (polymarket.marketType === 'unsupported' || sx.marketType === 'unsupported') {
    return undefined;
  }

  if (!sportsAreCompatible(polymarket.raw, canonicalSx)) {
    return undefined;
  }

  if (['outright', 'player_prop', 'team_prop'].includes(polymarket.marketType)) {
    return undefined;
  }

  if (canonicalSx.betType === 'unknown') {
    return undefined;
  }

  const maxTimeDeltaHours = maxTimeDeltaHoursForPair(polymarket.raw, canonicalSx, options.maxTimeDeltaHours);
  if (polymarket.eventTime && canonicalSx.eventTime && hoursBetween(polymarket.eventTime, canonicalSx.eventTime) > maxTimeDeltaHours) {
    return undefined;
  }

  const event = scoreCanonicalEvent(polymarket, canonicalSx);
  const intent = inferNormalizedPolymarketIntentAgainstSx(polymarket, canonicalSx);
  const singleTeamOutcomeMatch = isSingleTeamSoccerOutcomeMarket(polymarket.raw, canonicalSx, intent);
  if (
    event.score < options.minEventScore &&
    !(singleTeamOutcomeMatch && event.score >= 0.48 && isSingleTeamWinTargetCompatible(polymarket.raw, canonicalSx))
  ) {
    return undefined;
  }
  if (isWeakExplicitTennisHeadToHeadMatch(polymarket.raw, canonicalSx, event.teamScores)) {
    return undefined;
  }

  if (isDrawSportExplicitWinAgainstTwoWay(polymarket.raw, canonicalSx, intent)) {
    return undefined;
  }

  const segment = scoreCanonicalSegment(intent.segment, canonicalSx.segment);
  if (segment.rejected) {
    return undefined;
  }

  if (isPolymarketSetHandicap(polymarket.raw) && isTennisSxMarket(canonicalSx) && !isSxSetHandicap(canonicalSx.raw)) {
    return undefined;
  }

  const market = scoreCanonicalMarket(intent, canonicalSx, options.lineTolerance);
  if (market.rejected) {
    return undefined;
  }

  const timeScore = scoreCanonicalTime(polymarket.eventTime, canonicalSx.eventTime, maxTimeDeltaHours);
  const leagueScore = scoreCanonicalLeague(polymarket, canonicalSx);
  const textScore = scoreCanonicalText(polymarket, sx);
  const componentScores: MatchComponentScores = {
    event: roundScore(event.score),
    time: roundScore(timeScore),
    marketType: roundScore(market.typeScore),
    line: roundScore(market.marketScore),
    league: roundScore(leagueScore),
    text: roundScore(textScore)
  };

  const score = roundScore(
    componentScores.event * 0.38 +
      componentScores.line * 0.27 +
      componentScores.marketType * 0.15 +
      componentScores.time * 0.12 +
      componentScores.league * 0.05 +
      componentScores.text * 0.03
  );

  if (score < options.reviewScore) {
    return undefined;
  }

  const reasons: MatchReasons = {
    summary: buildCanonicalSummary(intent, canonicalSx, componentScores),
    teamScores: event.teamScores,
    timeDeltaHours:
      polymarket.eventTime && canonicalSx.eventTime
        ? roundScore(hoursBetween(polymarket.eventTime, canonicalSx.eventTime))
        : undefined,
    polymarketMarketType: polymarket.marketType,
    sxMarketType: sx.marketType,
    polymarketLine: intent.line,
    sxLine: canonicalSx.line,
    method: 'canonical',
    canonicalEventKey: canonicalSx.eventId ?? canonicalSx.teamPairKey,
    canonicalMarketKey: canonicalSx.marketKey,
    sxCanonicalMarketKey: canonicalSx.marketKey,
    polymarketCanonicalMarketKey: intent.marketKey,
    polymarketSide: intent.side,
    sxSide: canonicalSx.side,
    polymarketSegment: intent.segment,
    sxSegment: canonicalSx.segment,
    tokenMapping: buildOutcomeTokenMapping(polymarket.raw, canonicalSx.raw, {
      polymarketSide: intent.side,
      sxSide: canonicalSx.side,
      sxBetType: canonicalSx.betType,
      homeTeam: canonicalSx.homeTeam,
      awayTeam: canonicalSx.awayTeam,
      rawHomeTeam: canonicalSx.rawHomeTeam,
      rawAwayTeam: canonicalSx.rawAwayTeam
    })
  };

  return {
    polymarket: polymarket.raw,
    sx: canonicalSx.raw,
    polymarketId: polymarket.id,
    sxMarketHash: canonicalSx.id,
    score,
    confidence: confidenceForScore(score),
    status: score >= options.minScore ? 'matched' : 'needs_review',
    componentScores,
    reasons
  };
}

export function inferSxCanonicalBetType(
  market: SxMarket,
  homeTeam = canonicalTeamName(market.team_one_name),
  awayTeam = canonicalTeamName(market.team_two_name)
): CanonicalBetType {
  const type = Number(market.market_type);
  if (SX_12_TYPES.has(type)) {
    return '12';
  }
  if (SX_SPREAD_TYPES.has(type)) {
    return 'spread';
  }
  if (SX_TOTAL_TYPES.has(type)) {
    return 'total';
  }

  const inferred = inferSxMarketType(market);
  if (inferred === 'spread') {
    return 'spread';
  }
  if (inferred === 'total') {
    return 'total';
  }

  const outcomeOneSide = classifyOutcomeSide(market.outcome_one_name, homeTeam, awayTeam);
  const outcomeTwoSide = classifyOutcomeSide(market.outcome_two_name, homeTeam, awayTeam);
  if (
    (outcomeOneSide === 'home' && outcomeTwoSide === 'away') ||
    (outcomeOneSide === 'away' && outcomeTwoSide === 'home')
  ) {
    return '12';
  }

  if (type === 1 && ['home', 'away', 'draw'].includes(outcomeOneSide)) {
    return '1x2';
  }

  return inferred === 'moneyline' ? '12' : 'unknown';
}

export function inferPolymarketIntentAgainstSx(
  market: PolymarketMarket,
  sx: CanonicalSxMarket
): CanonicalPolymarketIntent {
  const marketType = inferPolymarketMarketType(market);
  const line = extractPolymarketLine(market, marketType);
  const fullText = normalizeText(buildPolymarketText(market));
  const sideText = buildPolymarketSideText(market) || fullText;
  const drawText = normalizeText(market.question);
  const sideTokens = tokenize(sideText);
  const side = inferPolymarketSideFromText(sideText, sx, marketType, (name) =>
    scoreNameAgainstText(name, sideText, sideTokens),
    drawText
  );
  const segment = inferPolymarketSegment(market);
  const betType = mapPolymarketTypeToCanonical(marketType, sx.betType, side);
  const marketKey = polymarketMarketKey(betType, side, line);

  return { betType, marketKey, side, segment, line, explicitSingleTeamWin: isExplicitSingleTeamWinMarket(market) };
}

function inferNormalizedPolymarketIntentAgainstSx(
  polymarket: NormalizedPolymarketMarket,
  sx: CanonicalSxMarket
): CanonicalPolymarketIntent {
  const side = inferPolymarketSide(polymarket, sx, polymarket.marketType);
  const segment = inferPolymarketSegment(polymarket.raw);
  const betType = mapPolymarketTypeToCanonical(polymarket.marketType, sx.betType, side);
  const marketKey = polymarketMarketKey(betType, side, polymarket.line);

  return {
    betType,
    marketKey,
    side,
    segment,
    line: polymarket.line,
    explicitSingleTeamWin: isExplicitSingleTeamWinMarket(polymarket.raw)
  };
}

function inferSxOutcomeSide(market: SxMarket, homeTeam: string, awayTeam: string): CanonicalSide {
  const side = classifyOutcomeSide(market.outcome_one_name, homeTeam, awayTeam);
  return side === 'unknown' && inferSxCanonicalBetType(market, homeTeam, awayTeam) === '12' ? 'unknown' : side;
}

function scoreCanonicalEvent(
  polymarket: NormalizedPolymarketMarket,
  sx: CanonicalSxMarket
): { score: number; teamScores: Array<{ team: string; score: number }> } {
  const home = bestTeamHit(polymarket, sx.rawHomeTeam, sx.homeTeam);
  const away = bestTeamHit(polymarket, sx.rawAwayTeam, sx.awayTeam);
  const worst = Math.min(home.score, away.score);
  const average = (home.score + away.score) / 2;
  const score = clamp(average * 0.68 + worst * 0.32, 0, 1);

  return {
    score,
    teamScores: [
      { team: sx.homeTeam, score: roundScore(home.score) },
      { team: sx.awayTeam, score: roundScore(away.score) }
    ]
  };
}

function bestTeamHit(polymarket: NormalizedPolymarketMarket, raw: string, canonical: string): TeamHit {
  let bestScore = 0;
  let firstPosition = Number.POSITIVE_INFINITY;

  for (const name of teamSearchNames(raw, canonical)) {
    bestScore = Math.max(bestScore, scoreNameAgainstPolymarketEvent(name, polymarket));
    const index = polymarketEventText(polymarket).indexOf(name);
    if (index >= 0) {
      firstPosition = Math.min(firstPosition, index);
    }
  }

  return {
    team: canonical,
    score: bestScore,
    firstPosition
  };
}

function scoreCanonicalMarket(
  intent: CanonicalPolymarketIntent,
  sx: CanonicalSxMarket,
  tolerance: number
): { typeScore: number; marketScore: number; rejected: boolean } {
  if (intent.betType === 'unknown') {
    return { typeScore: 0.52, marketScore: 0.48, rejected: false };
  }

  if (intent.betType !== sx.betType) {
    const compatibleMoneyline =
      (intent.betType === '12' && sx.betType === '1x2') ||
      (intent.betType === '1x2' && sx.betType === '12');
    if (!compatibleMoneyline) {
      return { typeScore: 0, marketScore: 0, rejected: true };
    }
  }

  if (sx.betType === '1x2') {
    if (intent.side === 'unknown') {
      return { typeScore: 0.86, marketScore: 0.66, rejected: false };
    }
    return {
      typeScore: 1,
      marketScore: intent.side === sx.side ? 1 : 0,
      rejected: intent.side !== sx.side
    };
  }

  if (sx.betType === '12') {
    if (!['home', 'away', 'unknown'].includes(intent.side)) {
      return { typeScore: 1, marketScore: 0, rejected: true };
    }

    return {
      typeScore: intent.betType === '12' || intent.betType === '1x2' ? 1 : 0.7,
      marketScore: explicitWinShouldPreferOneXTwo(intent) ? 0.78 : 1,
      rejected: false
    };
  }

  if (sx.betType === 'total') {
    return scoreLineLike(intent.line, sx.line, tolerance, false, intent.betType === sx.betType);
  }

  if (sx.betType === 'spread') {
    return scoreSpreadLine(intent, sx, tolerance, intent.betType === sx.betType);
  }

  return { typeScore: 0.5, marketScore: 0.5, rejected: false };
}

function scoreCanonicalSegment(
  polymarketSegment: CanonicalSegment,
  sxSegment: CanonicalSegment
): { rejected: boolean } {
  if (polymarketSegment === 'unknown' || sxSegment === 'unknown') {
    return { rejected: false };
  }

  return { rejected: polymarketSegment !== sxSegment };
}

function scoreLineLike(
  polymarketLine: number | undefined,
  sxLine: number | undefined,
  tolerance: number,
  _absolute: boolean,
  sameType: boolean
): { typeScore: number; marketScore: number; rejected: boolean } {
  if (polymarketLine === undefined || sxLine === undefined) {
    return { typeScore: sameType ? 0.9 : 0.62, marketScore: 0.52, rejected: false };
  }

  const diff = Math.abs(polymarketLine - sxLine);
  if (diff <= tolerance) {
    return { typeScore: sameType ? 1 : 0.72, marketScore: 1, rejected: false };
  }

  return { typeScore: sameType ? 1 : 0.72, marketScore: 0, rejected: true };
}

function scoreSpreadLine(
  intent: CanonicalPolymarketIntent,
  sx: CanonicalSxMarket,
  tolerance: number,
  sameType: boolean
): { typeScore: number; marketScore: number; rejected: boolean } {
  if (intent.line === undefined || sx.line === undefined) {
    return { typeScore: sameType ? 0.9 : 0.62, marketScore: 0.52, rejected: false };
  }

  const comparableSxLine = sxLineForPolymarketSide(intent.side, sx.side, sx.line);
  if (comparableSxLine === undefined) {
    return { typeScore: sameType ? 0.9 : 0.62, marketScore: 0.52, rejected: false };
  }

  const diff = Math.abs(intent.line - comparableSxLine);
  return {
    typeScore: sameType ? 1 : 0.72,
    marketScore: diff <= tolerance ? 1 : 0,
    rejected: diff > tolerance
  };
}

function sxLineForPolymarketSide(
  polymarketSide: CanonicalSide,
  sxSide: CanonicalSide,
  sxLine: number
): number | undefined {
  if (!['home', 'away'].includes(polymarketSide) || !['home', 'away'].includes(sxSide)) {
    return undefined;
  }

  return polymarketSide === sxSide ? sxLine : -sxLine;
}

function scoreCanonicalTime(
  polymarketTime: Date | undefined,
  sxTime: Date | undefined,
  maxTimeDeltaHours: number
): number {
  if (!polymarketTime || !sxTime) {
    return 0.58;
  }

  const delta = hoursBetween(polymarketTime, sxTime);
  if (delta > maxTimeDeltaHours) {
    return 0;
  }
  if (delta <= 1) {
    return 1;
  }
  if (delta <= 3) {
    return 0.94;
  }
  if (delta <= 6) {
    return 0.82;
  }
  if (delta <= 12) {
    return 0.68;
  }
  return 0.46;
}

function scoreCanonicalLeague(polymarket: NormalizedPolymarketMarket, sx: CanonicalSxMarket): number {
  const leagueScore = sx.league ? scoreNameAgainstPolymarket(sx.league, polymarket) : 0;
  const sportScore = sx.sport ? scoreNameAgainstPolymarket(sx.sport, polymarket) : 0;
  return Math.max(leagueScore, sportScore * 0.85, polymarket.raw.isSport ? 0.62 : 0.35);
}

function sportsAreCompatible(market: PolymarketMarket, sx: CanonicalSxMarket): boolean {
  const polymarketSport = inferPolymarketSport(market);
  const sxSport = inferSxSport(sx);
  return !polymarketSport || !sxSport || polymarketSport === sxSport;
}

function inferPolymarketSport(market: PolymarketMarket): string | undefined {
  const text = normalizeText([market.tags, market.question, market.marketSlug].filter(Boolean).join(' '));
  if (!text) {
    return undefined;
  }

  if (/\b(e sports|esports|lol|league of legends|counter strike|valorant|dota|call of duty)\b/.test(text)) {
    return 'esports';
  }
  if (/\b(mixed martial arts|mma|ufc)\b/.test(text)) {
    return 'mma';
  }
  if (/\b(basketball|nba|wnba|ncaab|germany bbl)\b/.test(text)) {
    return 'basketball';
  }
  if (/\b(baseball|mlb)\b/.test(text)) {
    return 'baseball';
  }
  if (/\b(ice hockey|hockey|nhl)\b/.test(text)) {
    return 'hockey';
  }
  if (/\b(tennis|atp|wta)\b/.test(text)) {
    return 'tennis';
  }
  if (/\b(cricket|ipl|indian premier league)\b/.test(text)) {
    return 'cricket';
  }
  if (/\b(lacrosse|pll|premier lacrosse league)\b/.test(text)) {
    return 'lacrosse';
  }
  if (/\b(soccer|bundesliga|serie a|la liga|ligue 1|eredivisie|copa libertadores|mls|major league soccer|premier league)\b/.test(text)) {
    return 'soccer';
  }

  return undefined;
}

function inferSxSport(sx: CanonicalSxMarket): string | undefined {
  const text = normalizeText([sx.sport, sx.league].filter(Boolean).join(' '));
  if (!text) {
    return undefined;
  }

  if (/\be sports\b|\besports\b|\blol\b|league of legends/.test(text)) {
    return 'esports';
  }
  if (/mixed martial arts|\bmma\b|\bufc\b/.test(text)) {
    return 'mma';
  }
  if (/basketball|\bnba\b|\bwnba\b|\bncaab\b/.test(text)) {
    return 'basketball';
  }
  if (/baseball|\bmlb\b/.test(text)) {
    return 'baseball';
  }
  if (/hockey|\bnhl\b/.test(text)) {
    return 'hockey';
  }
  if (/tennis|\batp\b|\bwta\b/.test(text)) {
    return 'tennis';
  }
  if (/cricket|\bipl\b/.test(text)) {
    return 'cricket';
  }
  if (/lacrosse|\bpll\b/.test(text)) {
    return 'lacrosse';
  }
  if (/soccer|bundesliga|serie a|la liga|ligue 1|eredivisie|copa libertadores|major league soccer/.test(text)) {
    return 'soccer';
  }

  return undefined;
}

function maxTimeDeltaHoursForPair(
  market: PolymarketMarket,
  sx: CanonicalSxMarket,
  fallback: number
): number {
  const sport = inferSxSport(sx) ?? inferPolymarketSport(market);

  if (sport === 'baseball') {
    return Math.min(fallback, 6);
  }

  return fallback;
}

function scoreCanonicalText(polymarket: NormalizedPolymarketMarket, sx: NormalizedSxMarket): number {
  return diceCoefficient(polymarket.normalizedText, sx.normalizedText);
}

function inferPolymarketSide(
  polymarket: NormalizedPolymarketMarket,
  sx: CanonicalSxMarket,
  marketType: string
): CanonicalSide {
  const sideText = buildPolymarketSideText(polymarket.raw) || polymarket.normalizedText;
  const drawText = normalizeText(polymarket.raw.question);
  const sideTokens = tokenize(sideText);
  return inferPolymarketSideFromText(sideText, sx, marketType, (name) =>
    scoreNameAgainstText(name, sideText, sideTokens),
    drawText
  );
}

function inferPolymarketSideFromText(
  text: string,
  sx: CanonicalSxMarket,
  marketType: string,
  scoreTeam: (name: string) => number,
  drawText = text
): CanonicalSide {
  if (marketType === 'total') {
    if (/\bover\b/.test(text)) {
      return 'over';
    }
    if (/\bunder\b/.test(text)) {
      return 'under';
    }
    return 'unknown';
  }

  if (marketType !== 'spread' && /\b(draw|tie)\b/.test(drawText)) {
    return 'draw';
  }

  const home = firstTeamMention(text, sx.rawHomeTeam, sx.homeTeam);
  const away = firstTeamMention(text, sx.rawAwayTeam, sx.awayTeam);
  const homeScore = scoreTeam(sx.homeTeam);
  const awayScore = scoreTeam(sx.awayTeam);

  if (home.position < away.position) {
    return home.negated ? 'not_home' : 'home';
  }
  if (away.position < home.position) {
    return away.negated ? 'not_away' : 'away';
  }
  if (homeScore > awayScore + 0.15) {
    return 'home';
  }
  if (awayScore > homeScore + 0.15) {
    return 'away';
  }

  return 'unknown';
}

function buildPolymarketSideText(market: PolymarketMarket): string {
  return normalizeText([market.question, market.marketSlug].filter(Boolean).join(' '));
}

function isExplicitSingleTeamWinMarket(market: PolymarketMarket): boolean {
  const text = buildPolymarketSideText(market);
  return (
    /\bwill\b.+\bwin\b/.test(text) ||
    /\bwill\b.+\bbeat\b/.test(text) ||
    /\bleading\s+at\s+halftime\b/.test(text)
  );
}

function explicitWinShouldPreferOneXTwo(intent: CanonicalPolymarketIntent): boolean {
  return intent.explicitSingleTeamWin && ['home', 'away'].includes(intent.side);
}

function isDrawSportExplicitWinAgainstTwoWay(
  market: PolymarketMarket,
  sx: CanonicalSxMarket,
  intent: CanonicalPolymarketIntent
): boolean {
  const sport = inferSxSport(sx) ?? inferPolymarketSport(market);
  return sport === 'soccer' && intent.explicitSingleTeamWin && sx.betType === '12';
}

function isSingleTeamSoccerOutcomeMarket(
  market: PolymarketMarket,
  sx: CanonicalSxMarket,
  intent: CanonicalPolymarketIntent
): boolean {
  const sport = inferSxSport(sx) ?? inferPolymarketSport(market);
  return (
    sport === 'soccer' &&
    intent.explicitSingleTeamWin &&
    intent.betType === '1x2' &&
    sx.betType === '1x2' &&
    intent.side === sx.side &&
    ['home', 'away'].includes(intent.side) &&
    isSxTeamNotTeamMarket(sx.raw)
  );
}

function isSxTeamNotTeamMarket(market: SxMarket): boolean {
  const outcomeOne = normalizeText(market.outcome_one_name);
  const outcomeTwo = normalizeText(market.outcome_two_name);
  return Boolean(outcomeOne && outcomeTwo.startsWith('not '));
}

function isSingleTeamWinTargetCompatible(market: PolymarketMarket, sx: CanonicalSxMarket): boolean {
  const targetText = extractSingleTeamWinTarget(market);
  if (!targetText) {
    return false;
  }

  const target = normalizeText(targetText);
  const targetTokens = teamIdentityTokens(target);
  if (targetTokens.length === 0) {
    return false;
  }

  const rawTeam = sx.side === 'home' ? sx.rawHomeTeam : sx.rawAwayTeam;
  const canonicalTeam = sx.side === 'home' ? sx.homeTeam : sx.awayTeam;
  for (const name of teamSearchNames(rawTeam, canonicalTeam)) {
    const normalizedName = normalizeText(name);
    const nameTokens = teamIdentityTokens(normalizedName);
    if (nameTokens.length === 0) {
      continue;
    }

    const hits = nameTokens.filter((token) => targetTokens.includes(token)).length;
    if (hits === nameTokens.length && targetTokens.every((token) => nameTokens.includes(token))) {
      return true;
    }
  }

  return false;
}

function extractSingleTeamWinTarget(market: PolymarketMarket): string | undefined {
  const question = String(market.question ?? '').trim();
  const match = question.match(/^will\s+(.+?)\s+(?:win|beat)\b/i);
  return match?.[1]?.trim();
}

function teamIdentityTokens(value: unknown): string[] {
  return significantNameTokens(value).filter(
    (token) => !GENERIC_TEAM_IDENTITY_TOKENS.has(token) && !/^\d+$/.test(token)
  );
}

function inferPolymarketSegment(market: PolymarketMarket): CanonicalSegment {
  const text = buildPolymarketSideText(market);
  if (!text) {
    return 'unknown';
  }

  const game = text.match(/\bgame\s*([1-5])\b/);
  if (game) {
    return `game${game[1]}` as CanonicalSegment;
  }

  if (/\bhalftime\b/.test(text)) {
    return 'half1';
  }

  if (/\b(2nd|second)\s+half\b|\b2h\b/.test(text)) {
    return 'half2';
  }

  if (/\b(1st|first)\s+half\b|\b1h\b/.test(text)) {
    return 'half1';
  }

  if (/\b(4th|fourth)\s+(quarter|period)\b|\b(q|quarter|period)\s*4\b/.test(text)) {
    return 'quarter4';
  }

  if (/\b(3rd|third)\s+(quarter|period)\b|\b(q|quarter|period)\s*3\b/.test(text)) {
    return 'quarter3';
  }

  if (/\b(2nd|second)\s+quarter\b|\b(q|quarter)\s*2\b/.test(text)) {
    return 'quarter2';
  }

  if (/\b(1st|first)\s+quarter\b|\b(q|quarter)\s*1\b/.test(text)) {
    return 'quarter1';
  }

  if (/\b(2nd|second)\s+(set|period)\b|\b(set|period)\s*2\b/.test(text)) {
    return 'period2';
  }

  if (
    /\b(1st|first)\s+(set|period)\b|\b(set|period)\s*1\b/.test(text) ||
    /\b(1st|first)\s+5\s+innings?\b|\bfirst\s+five\s+innings?\b|\bf5\b/.test(text)
  ) {
    return 'period1';
  }

  return 'full';
}

function inferSxSegment(market: SxMarket): CanonicalSegment {
  const type = Number(market.market_type);
  const text = normalizeText(
    [market.outcome_one_name, market.outcome_two_name, market.group1, market.group2].filter(Boolean).join(' ')
  );
  const sportText = normalizeText([market.sport_label, market.league_label].filter(Boolean).join(' '));
  const game = text.match(/\bgame\s*([1-5])\b/);
  if (game) {
    return `game${game[1]}` as CanonicalSegment;
  }

  if (isBasketballMarket(market, sportText)) {
    if (/\b(2nd|second)\s+half\b|\b2h\b/.test(text)) {
      return 'half2';
    }
    if (/\b(1st|first)\s+half\b|\b1h\b/.test(text)) {
      return 'half1';
    }
    if (/\b(4th|fourth)\s+(period|quarter)\b|\b(q|quarter|period)\s*4\b/.test(text)) {
      return 'quarter4';
    }
    if (/\b(3rd|third)\s+(period|quarter)\b|\b(q|quarter|period)\s*3\b/.test(text)) {
      return 'quarter3';
    }
    if (/\b(2nd|second)\s+(period|quarter)\b|\b(q|quarter|period)\s*2\b/.test(text)) {
      return 'quarter2';
    }
    if (/\b(1st|first)\s+(period|quarter)\b|\b(q|quarter|period)\s*1\b/.test(text)) {
      return 'quarter1';
    }

    if ([53, 63].includes(type)) {
      return 'half1';
    }
    if ([54].includes(type)) {
      return 'half2';
    }
    if ([64, 202].includes(type)) {
      return 'quarter1';
    }
    if ([65, 203].includes(type)) {
      return 'quarter2';
    }
    if ([66, 204].includes(type)) {
      return 'quarter3';
    }
    if ([67, 205].includes(type)) {
      return 'quarter4';
    }

    return 'full';
  }

  if (type === 202) {
    return 'period1';
  }
  if (type === 203) {
    return 'period2';
  }

  if (/\b(2nd|second)\s+half\b|\b2h\b/.test(text)) {
    return 'half2';
  }
  if (/\b(1st|first)\s+half\b|\b1h\b/.test(text)) {
    return 'half1';
  }
  if (/\b(4th|fourth)\s+period\b|\bperiod\s*4\b/.test(text)) {
    return 'period4';
  }
  if (/\b(3rd|third)\s+period\b|\bperiod\s*3\b/.test(text)) {
    return 'period3';
  }
  if (/\b(2nd|second)\s+(period|set)\b/.test(text)) {
    return 'period2';
  }
  if (
    /\b(1st|first)\s+(period|set)\b/.test(text) ||
    /\b(1st|first)\s+5\s+innings?\b|\bfirst\s+five\s+innings?\b|\bf5\b/.test(text)
  ) {
    return 'period1';
  }

  return 'full';
}

function isBasketballMarket(market: SxMarket, sportText: string): boolean {
  return (
    Number(market.sport_id) === 4 ||
    /\b(basketball|nba|wnba|ncaa basketball|ncaab)\b/.test(sportText)
  );
}

const polymarketNameScoreCache = new WeakMap<NormalizedPolymarketMarket, Map<string, number>>();
const polymarketEventTextCache = new WeakMap<NormalizedPolymarketMarket, string>();
const polymarketEventNameScoreCache = new WeakMap<NormalizedPolymarketMarket, Map<string, number>>();

function scoreNameAgainstPolymarket(name: unknown, polymarket: NormalizedPolymarketMarket): number {
  const key = normalizeText(name);
  if (!key) {
    return 0;
  }

  let marketCache = polymarketNameScoreCache.get(polymarket);
  if (!marketCache) {
    marketCache = new Map();
    polymarketNameScoreCache.set(polymarket, marketCache);
  }

  const cached = marketCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const score = scoreNameAgainstText(key, polymarket.normalizedText, polymarket.tokens);
  marketCache.set(key, score);
  return score;
}

function scoreNameAgainstPolymarketEvent(name: unknown, polymarket: NormalizedPolymarketMarket): number {
  const key = normalizeText(name);
  if (!key) {
    return 0;
  }

  let marketCache = polymarketEventNameScoreCache.get(polymarket);
  if (!marketCache) {
    marketCache = new Map();
    polymarketEventNameScoreCache.set(polymarket, marketCache);
  }

  const cached = marketCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const text = polymarketEventText(polymarket);
  const score = scoreNameAgainstText(key, text, tokenize(text));
  marketCache.set(key, score);
  return score;
}

function polymarketEventText(polymarket: NormalizedPolymarketMarket): string {
  const cached = polymarketEventTextCache.get(polymarket);
  if (cached !== undefined) {
    return cached;
  }

  const primary = [polymarket.raw.question, polymarket.raw.marketSlug].filter(Boolean).join(' ');
  const extracted = extractParticipantClause(polymarket.raw.description);
  const supportingText =
    extracted ?? compactEventDescription(polymarket.raw.description) ?? sanitizedEventDescription(polymarket.raw.description);
  const text = normalizeText([primary, supportingText].filter(Boolean).join(' ')) || polymarket.normalizedText;
  polymarketEventTextCache.set(polymarket, text);
  return text;
}

function extractParticipantClause(description: unknown): string | undefined {
  if (typeof description !== 'string' || !description.trim()) {
    return undefined;
  }

  const match = description.match(
    /\b(?:fight|bout|match|game)\s+between\s+(.+?)(?:\s+at\s+|\s+in\s+|,\s*scheduled|\s+scheduled|\.|\n)/i
  );
  return match?.[1]?.trim();
}

function compactEventDescription(description: unknown): string | undefined {
  if (typeof description !== 'string') {
    return undefined;
  }

  const normalized = description.trim();
  if (normalized.length > 180 || !/\b(vs?\.?|versus)\b/i.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function sanitizedEventDescription(description: unknown): string | undefined {
  if (typeof description !== 'string' || !description.trim()) {
    return undefined;
  }

  const sanitized = description
    .replace(/\bat\s+UFC\s+\d+:\s*[^,.]+(?:,\s*scheduled[^.]+)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized ? sanitized.slice(0, 1200) : undefined;
}

function isPolymarketSetHandicap(market: PolymarketMarket): boolean {
  return /\bset\s+handicap\b/i.test([market.question, market.marketSlug].filter(Boolean).join(' '));
}

function isTennisSxMarket(sx: CanonicalSxMarket): boolean {
  return /\btennis\b/i.test([sx.sport, sx.league].filter(Boolean).join(' '));
}

function isWeakExplicitTennisHeadToHeadMatch(
  market: PolymarketMarket,
  sx: CanonicalSxMarket,
  teamScores: Array<{ team: string; score: number }>
): boolean {
  if (!isTennisSxMarket(sx) || !hasExplicitHeadToHeadQuestion(market) || teamScores.length < 2) {
    return false;
  }

  return Math.min(...teamScores.map((entry) => entry.score)) < 0.6;
}

function hasExplicitHeadToHeadQuestion(market: PolymarketMarket): boolean {
  return /\b(?:vs\.?|versus)\b/i.test(String(market.question ?? ''));
}

function isSxSetHandicap(market: SxMarket): boolean {
  return (
    Number(market.market_type) === 866 ||
    /\(sets?\)/i.test([market.outcome_one_name, market.outcome_two_name].filter(Boolean).join(' '))
  );
}

function firstTeamMention(text: string, raw: string, canonical: string): { position: number; negated: boolean } {
  let position = Number.POSITIVE_INFINITY;
  let negated = false;

  for (const name of teamSearchNames(raw, canonical)) {
    const index = text.indexOf(name);
    if (index >= 0 && index < position) {
      position = index;
      negated = new RegExp(`\\bnot\\s+${escapeRegex(name)}\\b`).test(text);
    }
  }

  return { position, negated };
}

function classifyOutcomeSide(label: unknown, homeTeam: string, awayTeam: string): CanonicalSide {
  const text = normalizeText(label);
  if (!text) {
    return 'unknown';
  }

  if (/\b(draw|tie)\b/.test(text)) {
    return text.startsWith('not ') ? 'not_draw' : 'draw';
  }
  if (/^over\b/.test(text)) {
    return 'over';
  }
  if (/^under\b/.test(text)) {
    return 'under';
  }

  const homeNames = teamSearchNames(homeTeam);
  const awayNames = teamSearchNames(awayTeam);
  if (matchesAnyTeamName(text, homeNames)) {
    return text.startsWith('not ') ? 'not_home' : 'home';
  }
  if (matchesAnyTeamName(text, awayNames)) {
    return text.startsWith('not ') ? 'not_away' : 'away';
  }

  return 'unknown';
}

function matchesAnyTeamName(text: string, names: string[]): boolean {
  return names.some(
    (name) =>
      text === name ||
      text.startsWith(`${name} `) ||
      text.endsWith(` ${name}`) ||
      text.includes(` ${name} `)
  );
}

function mapPolymarketTypeToCanonical(
  marketType: string,
  sxBetType: CanonicalBetType,
  side: CanonicalSide
): CanonicalBetType {
  if (marketType === 'spread') {
    return 'spread';
  }
  if (marketType === 'total') {
    return 'total';
  }
  if (marketType === 'moneyline') {
    return sxBetType === '1x2' && ['draw', 'not_draw'].includes(side) ? '1x2' : sxBetType === '1x2' ? '1x2' : '12';
  }
  if (sxBetType === '1x2' && ['home', 'away', 'draw', 'not_home', 'not_away', 'not_draw'].includes(side)) {
    return '1x2';
  }
  if (sxBetType === '12' && ['home', 'away', 'unknown'].includes(side)) {
    return '12';
  }
  return 'unknown';
}

function sxMarketKey(betType: CanonicalBetType, side: CanonicalSide, line: number | undefined): string {
  if (betType === '1x2') {
    return `1x2:${side}`;
  }
  if (betType === '12') {
    return '12';
  }
  if (betType === 'spread') {
    return `spread:${formatLine(line, true)}`;
  }
  if (betType === 'total') {
    return `total:${formatLine(line, false)}`;
  }
  return 'unknown';
}

function polymarketMarketKey(betType: CanonicalBetType, side: CanonicalSide, line: number | undefined): string {
  if (betType === '1x2') {
    return `1x2:${side}`;
  }
  if (betType === '12') {
    return '12';
  }
  if (betType === 'spread') {
    return `spread:${formatLine(line, true)}`;
  }
  if (betType === 'total') {
    return `total:${formatLine(line, false)}`;
  }
  return 'unknown';
}

function formatLine(line: number | undefined, absolute: boolean): string {
  if (line === undefined) {
    return 'unknown';
  }
  const value = absolute ? Math.abs(line) : line;
  return String(value === 0 ? 0 : value);
}

function buildCanonicalSummary(
  intent: CanonicalPolymarketIntent,
  sx: CanonicalSxMarket,
  components: MatchComponentScores
): string[] {
  const summary = [
    `canonical event matched ${sx.homeTeam} vs ${sx.awayTeam}`,
    `SX market key ${sx.marketKey}`
  ];

  if (intent.marketKey !== 'unknown') {
    summary.push(`Polymarket market key ${intent.marketKey}`);
  }
  if (components.time >= 0.94) {
    summary.push('event time matches closely');
  }
  if (components.line >= 0.99 && sx.line !== undefined) {
    summary.push(`line matches at ${sx.line}`);
  }

  return summary;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
