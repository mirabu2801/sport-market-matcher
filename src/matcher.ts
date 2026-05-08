import { DEFAULT_MATCH_OPTIONS, normalizePolymarketMarket, normalizeSxMarket, scorePair } from './scoring';
import { canonicalizeSxMarket, scoreCanonicalPair, type CanonicalSxMarket } from './canonical';
import { hoursBetween, roundScore, tokenize } from './normalization';
import { teamSearchNames } from './teamAliases';
import type {
  CandidateMatch,
  MatchOptions,
  MatchResult,
  NormalizedPolymarketMarket,
  NormalizedSxMarket,
  PolymarketMarket,
  SxMarket
} from './types';

export function matchMarkets(
  polymarketMarkets: PolymarketMarket[],
  sxMarkets: SxMarket[],
  partialOptions: Partial<MatchOptions> = {}
): MatchResult {
  const options: MatchOptions = { ...DEFAULT_MATCH_OPTIONS, ...partialOptions };
  const normalizedPolymarket = polymarketMarkets.map(normalizePolymarketMarket);
  const normalizedSx = sxMarkets.map(normalizeSxMarket);
  const canonicalSxById = new Map(
    normalizedSx
      .map((sx) => [sx.id, canonicalizeSxMarket(sx.raw)] as const)
      .filter((entry): entry is readonly [string, NonNullable<ReturnType<typeof canonicalizeSxMarket>>] =>
        Boolean(entry[1])
      )
  );
  const sxDateBlocks = buildSxDateBlocks(normalizedSx, canonicalSxById);
  const allCandidates: CandidateMatch[] = [];
  const progressEvery = parseProgressEvery();
  const startedAt = Date.now();
  let consideredPairs = 0;

  for (let index = 0; index < normalizedPolymarket.length; index += 1) {
    const polymarket = normalizedPolymarket[index]!;
    const candidatesForMarket = new Map<string, CandidateMatch>();
    const sxCandidates = getSxCandidatesForPolymarket(polymarket, normalizedSx, sxDateBlocks);
    consideredPairs += sxCandidates.length;

    for (const sx of sxCandidates) {
      if (
        polymarket.eventTime &&
        sx.eventTime &&
        hoursBetween(polymarket.eventTime, sx.eventTime) > options.maxTimeDeltaHours
      ) {
        continue;
      }

      const canonicalSx = canonicalSxById.get(sx.id);
      if (canonicalSx) {
        const canonicalCandidate = scoreCanonicalPair(polymarket, sx, canonicalSx, options);
        if (canonicalCandidate) {
          upsertBestCandidate(candidatesForMarket, canonicalCandidate);
        }
        continue;
      }

      const fuzzyCandidate = scorePair(polymarket, sx, options);
      if (fuzzyCandidate && fuzzyCandidate.score >= options.reviewScore) {
        fuzzyCandidate.reasons.method = 'fuzzy';
        upsertBestCandidate(candidatesForMarket, fuzzyCandidate);
      }
    }

    [...candidatesForMarket.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, options.maxCandidatesPerPolymarket)
      .forEach((candidate) => allCandidates.push(candidate));

    if (progressEvery > 0 && (index + 1) % progressEvery === 0) {
      const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `Matched progress ${index + 1}/${normalizedPolymarket.length}; considered ${consideredPairs} SX pairs; kept ${allCandidates.length} candidates; ${elapsedSeconds}s.`
      );
    }
  }

  return finalizeCandidateMatches(allCandidates, polymarketMarkets.length, sxMarkets.length, options);
}

export function finalizeCandidateMatches(
  candidates: CandidateMatch[],
  polymarketCount: number,
  sxCount: number,
  partialOptions: Partial<MatchOptions> = {}
): MatchResult {
  const options: MatchOptions = { ...DEFAULT_MATCH_OPTIONS, ...partialOptions };
  const allCandidates = [...candidates].sort((left, right) => right.score - left.score);
  const selected = selectOneToOneMatches(allCandidates, options);
  const selectedSet = new Set(selected.matches);
  const reviewCandidates = allCandidates
    .filter((candidate) => !selectedSet.has(candidate))
    .filter((candidate) => candidate.score >= options.reviewScore)
    .map((candidate) => ({ ...candidate, status: 'needs_review' as const }));

  return {
    matches: selected.matches,
    reviewCandidates,
    allCandidates,
    stats: {
      polymarketCount,
      sxCount,
      candidateCount: allCandidates.length,
      matchCount: selected.matches.length,
      reviewCount: reviewCandidates.length
    }
  };
}

function parseProgressEvery(): number {
  const value = Number(process.env.MATCH_PROGRESS_EVERY ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function upsertBestCandidate(candidates: Map<string, CandidateMatch>, candidate: CandidateMatch): void {
  const existing = candidates.get(candidate.sxMarketHash);
  if (!existing || candidate.score > existing.score) {
    candidates.set(candidate.sxMarketHash, candidate);
  }
}

function selectOneToOneMatches(
  candidates: CandidateMatch[],
  options: MatchOptions
): { matches: CandidateMatch[] } {
  const usedPolymarket = new Set<string>();
  const usedSx = new Set<string>();
  const byPolymarket = groupCandidates(candidates, (candidate) => candidate.polymarketId);
  const bySx = groupCandidates(candidates, (candidate) => candidate.sxMarketHash);
  const matches: CandidateMatch[] = [];

  for (const candidate of candidates) {
    if (candidate.score < options.minScore) {
      continue;
    }

    if (usedPolymarket.has(candidate.polymarketId) || usedSx.has(candidate.sxMarketHash)) {
      continue;
    }

    const pmAlternative = bestUnusedAlternative(
      byPolymarket.get(candidate.polymarketId) ?? [],
      candidate,
      usedPolymarket,
      usedSx
    );
    const sxAlternative = bestUnusedAlternative(
      bySx.get(candidate.sxMarketHash) ?? [],
      candidate,
      usedPolymarket,
      usedSx
    );
    const nearestAlternativeScore = Math.max(pmAlternative?.score ?? 0, sxAlternative?.score ?? 0);
    const ambiguityMargin = roundScore(candidate.score - nearestAlternativeScore);

    if (ambiguityMargin < options.ambiguityGap) {
      candidate.reasons.ambiguityMargin = ambiguityMargin;
      candidate.status = 'needs_review';
      continue;
    }

    candidate.reasons.ambiguityMargin = ambiguityMargin;
    candidate.status = 'matched';
    matches.push(candidate);
    usedPolymarket.add(candidate.polymarketId);
    usedSx.add(candidate.sxMarketHash);
  }

  return { matches };
}

function bestUnusedAlternative(
  candidates: CandidateMatch[],
  current: CandidateMatch,
  usedPolymarket: Set<string>,
  usedSx: Set<string>
): CandidateMatch | undefined {
  return candidates.find(
    (candidate) =>
      candidate !== current &&
      !usedPolymarket.has(candidate.polymarketId) &&
      !usedSx.has(candidate.sxMarketHash)
  );
}

function groupCandidates(
  candidates: CandidateMatch[],
  keyFn: (candidate: CandidateMatch) => string
): Map<string, CandidateMatch[]> {
  const groups = new Map<string, CandidateMatch[]>();

  for (const candidate of candidates) {
    const key = keyFn(candidate);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.sort((left, right) => right.score - left.score);
  }

  return groups;
}

interface SxDateBlocks {
  byDate: Map<string, NormalizedSxMarket[]>;
  withoutDate: NormalizedSxMarket[];
  byTeamKey: Map<string, NormalizedSxMarket[]>;
}

function buildSxDateBlocks(
  markets: NormalizedSxMarket[],
  canonicalSxById: Map<string, CanonicalSxMarket>
): SxDateBlocks {
  const byDate = new Map<string, NormalizedSxMarket[]>();
  const withoutDate: NormalizedSxMarket[] = [];
  const byTeamKey = new Map<string, NormalizedSxMarket[]>();

  for (const market of markets) {
    const canonical = canonicalSxById.get(market.id);
    if (canonical) {
      for (const teamKey of teamKeysForCanonicalSx(canonical)) {
        const teamGroup = byTeamKey.get(teamKey) ?? [];
        teamGroup.push(market);
        byTeamKey.set(teamKey, teamGroup);
      }
    }

    if (!market.eventTime) {
      withoutDate.push(market);
      continue;
    }

    const key = dateKey(market.eventTime);
    const group = byDate.get(key) ?? [];
    group.push(market);
    byDate.set(key, group);
  }

  return {
    byDate,
    withoutDate,
    byTeamKey
  };
}

function getSxCandidatesForPolymarket(
  polymarket: NormalizedPolymarketMarket,
  allSx: NormalizedSxMarket[],
  blocks: SxDateBlocks
): NormalizedSxMarket[] {
  if (!polymarket.eventTime) {
    const teamCandidates = sxCandidatesByTeamKeys(polymarket, blocks);
    return teamCandidates.length > 0 ? teamCandidates : [];
  }

  const dateCandidates = new Map<string, NormalizedSxMarket>();

  for (const key of adjacentDateKeys(polymarket.eventTime)) {
    for (const sx of blocks.byDate.get(key) ?? []) {
      dateCandidates.set(sx.id, sx);
    }
  }

  const teamCandidates = sxCandidatesByTeamKeys(polymarket, blocks, dateCandidates);
  if (teamCandidates.length > 0) {
    return teamCandidates;
  }

  return [];
}

function sxCandidatesByTeamKeys(
  polymarket: NormalizedPolymarketMarket,
  blocks: SxDateBlocks,
  allowedByDate?: Map<string, NormalizedSxMarket>
): NormalizedSxMarket[] {
  const candidates = new Map<string, NormalizedSxMarket>();
  const searched = new Set<string>();

  for (const key of polymarket.tokens) {
    if (searched.has(key)) {
      continue;
    }
    searched.add(key);

    for (const sx of blocks.byTeamKey.get(key) ?? []) {
      if (allowedByDate && sx.eventTime && !allowedByDate.has(sx.id)) {
        continue;
      }
      candidates.set(sx.id, sx);
    }
  }

  return [...candidates.values()];
}

function teamKeysForCanonicalSx(canonical: CanonicalSxMarket): string[] {
  const keys = new Set<string>();
  for (const name of [
    ...teamSearchNames(canonical.rawHomeTeam, canonical.homeTeam),
    ...teamSearchNames(canonical.rawAwayTeam, canonical.awayTeam)
  ]) {
    for (const key of tokenize(name)) {
      if (isUsefulTeamKey(key)) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

function isUsefulTeamKey(key: string): boolean {
  return (
    key.length > 2 &&
    ![
      'city',
      'club',
      'team',
      'united',
      'state',
      'real',
      'sporting',
      'sport',
      'sports',
      'esport',
      'esports',
      'athletic',
      'atletico',
      'saint',
      'los',
      'las',
      'new',
      'san',
      'st'
    ].includes(key)
  );
}

function adjacentDateKeys(date: Date): string[] {
  return [-1, 0, 1].map((offset) => {
    const shifted = new Date(date);
    shifted.setUTCDate(shifted.getUTCDate() + offset);
    return dateKey(shifted);
  });
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
