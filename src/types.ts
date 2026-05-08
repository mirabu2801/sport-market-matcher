export type MarketType =
  | 'moneyline'
  | 'spread'
  | 'total'
  | 'player_prop'
  | 'team_prop'
  | 'outright'
  | 'unsupported'
  | 'unknown';

export type MatchConfidence = 'high' | 'medium' | 'review' | 'low';

export type CanonicalBetType = '1x2' | '12' | 'spread' | 'total' | 'unknown';

export type CanonicalSide =
  | 'home'
  | 'away'
  | 'draw'
  | 'over'
  | 'under'
  | 'not_home'
  | 'not_away'
  | 'not_draw'
  | 'unknown';

export interface PolymarketMarket {
  conditionId: string;
  questionId?: string | null;
  marketSlug?: string | null;
  question: string;
  description?: string | null;
  active?: boolean | null;
  closed?: boolean | null;
  archived?: boolean | null;
  acceptingOrders?: boolean | null;
  endDateIso?: string | null;
  gameStartTime?: string | null;
  isSport?: boolean | null;
  isCrypto?: boolean | null;
  tags?: string | null;
  tokens?: unknown;
}

export interface SxMarket {
  market_hash: string;
  status?: string | null;
  outcome_one_name?: string | null;
  outcome_two_name?: string | null;
  outcome_void_name?: string | null;
  team_one_name?: string | null;
  team_two_name?: string | null;
  market_type?: number | null;
  game_time?: number | string | null;
  game_time_at?: Date | string | null;
  line?: number | string | null;
  sport_x_event_id?: string | null;
  live_enabled?: boolean | null;
  sport_label?: string | null;
  sport_id?: number | null;
  league_id?: number | null;
  league_label?: string | null;
  group1?: string | null;
  group2?: string | null;
  participant_one_id?: number | null;
  participant_two_id?: number | null;
  main_line?: boolean | null;
  raw?: unknown;
}

export interface NormalizedPolymarketMarket {
  source: 'polymarket';
  id: string;
  raw: PolymarketMarket;
  text: string;
  normalizedText: string;
  tokens: string[];
  tokenSet: Set<string>;
  eventTime?: Date;
  marketType: MarketType;
  line?: number;
}

export interface NormalizedSxMarket {
  source: 'sx';
  id: string;
  raw: SxMarket;
  text: string;
  normalizedText: string;
  tokens: string[];
  tokenSet: Set<string>;
  eventTime?: Date;
  marketType: MarketType;
  line?: number;
  teamNames: string[];
  sportLabel?: string;
  leagueLabel?: string;
}

export interface MatchComponentScores {
  event: number;
  time: number;
  marketType: number;
  line: number;
  league: number;
  text: number;
}

export interface MatchReasons {
  summary: string[];
  teamScores: Array<{ team: string; score: number }>;
  timeDeltaHours?: number;
  polymarketMarketType: MarketType;
  sxMarketType: MarketType;
  polymarketLine?: number;
  sxLine?: number;
  ambiguityMargin?: number;
  method?: 'canonical' | 'fuzzy';
  canonicalEventKey?: string;
  canonicalMarketKey?: string;
  sxCanonicalMarketKey?: string;
  polymarketCanonicalMarketKey?: string;
  polymarketSide?: CanonicalSide;
  sxSide?: CanonicalSide;
  polymarketSegment?: string;
  sxSegment?: string;
  tokenMapping?: OutcomeTokenMapping;
}

export interface PolymarketOutcomeToken {
  index: number;
  pmToken: string;
  tokenId?: string;
  outcome: string;
}

export interface OutcomeTokenMappingEntry {
  sxToken: string;
  sxTokenIndex: 0 | 1;
  sxOutcome: string;
  pmToken?: string;
  pmTokenIndex?: number;
  pmTokenId?: string;
  pmOutcome?: string;
  score: number;
  method: 'side' | 'text' | 'side+text' | 'unmatched';
  sxSide?: CanonicalSide;
  pmSide?: CanonicalSide;
}

export interface OutcomeTokenMapping {
  summary: string[];
  sxToken0?: OutcomeTokenMappingEntry;
  sxToken1?: OutcomeTokenMappingEntry;
}

export interface CandidateMatch {
  polymarket: PolymarketMarket;
  sx: SxMarket;
  polymarketId: string;
  sxMarketHash: string;
  score: number;
  confidence: MatchConfidence;
  status: 'matched' | 'needs_review' | 'rejected';
  componentScores: MatchComponentScores;
  reasons: MatchReasons;
}

export interface MatchResult {
  matches: CandidateMatch[];
  reviewCandidates: CandidateMatch[];
  allCandidates: CandidateMatch[];
  stats: {
    polymarketCount: number;
    sxCount: number;
    candidateCount: number;
    matchCount: number;
    reviewCount: number;
  };
}

export interface MatchOptions {
  minScore: number;
  reviewScore: number;
  ambiguityGap: number;
  maxTimeDeltaHours: number;
  lineTolerance: number;
  minEventScore: number;
  maxCandidatesPerPolymarket: number;
}
