import assert from 'node:assert/strict';
import { loadConfig } from '../src/config';
import { matchMarkets } from '../src/matcher';
import type { PolymarketMarket, SxMarket } from '../src/types';
import {
  udvardyMertensPolymarket,
  udvardyMertensSetHandicapPolymarket,
  udvardyMertensSetHandicapSx,
  udvardyMertensSx
} from './fixtures/udvardy-mertens';

const basePm: Omit<PolymarketMarket, 'conditionId' | 'question'> = {
  questionId: 'q',
  marketSlug: 'nba-lakers-celtics',
  description: 'Los Angeles Lakers vs Boston Celtics',
  active: true,
  closed: false,
  archived: false,
  acceptingOrders: true,
  gameStartTime: '2026-05-10T00:00:00.000Z',
  isSport: true
};

const baseSx: Omit<SxMarket, 'market_hash'> = {
  status: 'active',
  team_one_name: 'Los Angeles Lakers',
  team_two_name: 'Boston Celtics',
  outcome_one_name: 'Los Angeles Lakers',
  outcome_two_name: 'Boston Celtics',
  market_type: 1,
  game_time_at: '2026-05-10T00:00:00.000Z',
  sport_label: 'Basketball',
  league_label: 'NBA'
};

{
  const config = loadConfig({
    DATABASE_URL: '',
    POSTGRESQL_HOST: '10.10.0.50',
    POSTGRESQL_PORT: '5432',
    POSTGRESQL_USER: 'postgres',
    POSTGRESQL_PASSWORD: '',
    POSTGRESQL_DB: 'postgres',
    POSTGRESQL_SSL: 'false',
    POSTGRESQL_SSLMODE: 'disable'
  });

  assert.equal(config.databaseUrl, 'postgresql://postgres@10.10.0.50:5432/postgres?sslmode=disable');
}

{
  const config = loadConfig({
    POSTGRESQL_HOST: 'db.internal',
    POSTGRESQL_PORT: '5432',
    POSTGRESQL_USER: 'matcher',
    POSTGRESQL_PASSWORD: 'p@ ss',
    POSTGRESQL_DB: 'markets',
    POSTGRESQL_SSL: 'true'
  });

  assert.equal(config.databaseUrl, 'postgresql://matcher:p%40%20ss@db.internal:5432/markets?sslmode=require');
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-moneyline',
        question: 'Will the Los Angeles Lakers beat the Boston Celtics?'
      }
    ],
    [{ ...baseSx, market_hash: 'sx-moneyline' }],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, 'pm-moneyline');
  assert.equal(result.matches[0]?.sxMarketHash, 'sx-moneyline');
  assert.equal(result.matches[0]?.reasons.method, 'canonical');
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-moneyline-yes-no',
        question: 'Will the Los Angeles Lakers beat the Boston Celtics?',
        tokens: JSON.stringify([
          { token_id: 'yes-token', outcome: 'Yes' },
          { token_id: 'no-token', outcome: 'No' }
        ])
      }
    ],
    [
      {
        ...baseSx,
        market_hash: 'sx-moneyline-swapped',
        market_type: 52,
        outcome_one_name: 'Boston Celtics',
        outcome_two_name: 'Los Angeles Lakers'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );
  const match = result.matches[0];

  assert.equal(result.matches.length, 1);
  assert.equal(match?.reasons.tokenMapping?.sxToken0?.pmTokenIndex, 1);
  assert.equal(match?.reasons.tokenMapping?.sxToken1?.pmTokenIndex, 0);
  assert.deepEqual(match?.reasons.tokenMapping?.summary, ['pm_token1=sx_token0', 'pm_token0=sx_token1']);
}

{
  const result = matchMarkets(
    [
      {
        conditionId: 'pm-tennis-title-only',
        questionId: 'q-tennis',
        question: "Internazionali BNL d'Italia: Panna Udvardy vs Elise Mertens",
        marketSlug: 'wta-udvardy-mertens-2026-05-07',
        description:
          'This market refers to a tennis match originally scheduled for May 7, 5:00am ET. If the match ends in a tie or one player withdraws before the start, rules apply.',
        active: true,
        closed: false,
        archived: false,
        acceptingOrders: true,
        gameStartTime: '2026-05-07T09:00:00.000Z',
        isSport: true
      }
    ],
    [
      {
        market_hash: 'sx-tennis-moneyline',
        status: 'active',
        team_one_name: 'Panna Udvardy',
        team_two_name: 'Elise Mertens',
        outcome_one_name: 'Panna Udvardy',
        outcome_two_name: 'Elise Mertens',
        outcome_void_name: 'NO_CONTEST',
        market_type: 52,
        game_time_at: '2026-05-07T09:00:00.000Z',
        sport_label: 'Tennis',
        league_label: 'WTA Rome'
      }
    ],
    { minScore: 0.78, reviewScore: 0.66 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.reasons.polymarketMarketType, 'moneyline');
  assert.equal(result.matches[0]?.sxMarketHash, 'sx-tennis-moneyline');
}

{
  const result = matchMarkets(
    [udvardyMertensPolymarket],
    [udvardyMertensSx],
    { minScore: 0.78, reviewScore: 0.66 }
  );
  const match = result.matches[0];

  assert.equal(result.stats.candidateCount, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.reviewCandidates.length, 0);
  assert.equal(match?.polymarketId, '0x055bddea356444684bfb8d34e9ba41c59baee260e1146ff197bf1c30e330f558');
  assert.equal(match?.sxMarketHash, '0xfb247e0b53e55c9519ac1f190e58718dad4729338c0e16f319bf01c2ba813b83');
  assert.equal(match?.confidence, 'high');
  assert.equal(match?.reasons.method, 'canonical');
  assert.equal(match?.reasons.polymarketMarketType, 'moneyline');
  assert.equal(match?.reasons.sxMarketType, 'moneyline');
  assert.equal(match?.reasons.polymarketCanonicalMarketKey, '12');
  assert.equal(match?.reasons.sxCanonicalMarketKey, '12');
  assert.equal(match?.reasons.polymarketSide, 'home');
  assert.equal(match?.reasons.sxSide, 'home');
  assert.deepEqual(match?.reasons.tokenMapping?.summary, ['pm_token0=sx_token0', 'pm_token1=sx_token1']);
  assert.equal(match?.reasons.tokenMapping?.sxToken0?.pmTokenId, '45572838953758994816038479695980826899969889984822306270204970258380018598420');
  assert.equal(match?.componentScores.event, 1);
  assert.equal(match?.componentScores.time, 1);
  assert.ok((match?.score ?? 0) >= 0.96);
}

{
  const matchTotal: PolymarketMarket = {
    ...udvardyMertensPolymarket,
    conditionId: 'pm-udvardy-mertens-match-total',
    question: 'Udvardy vs. Mertens: Match O/U 23.5',
    marketSlug: 'udvardy-mertens-match-ou-23-5'
  };
  const setOneWinner: PolymarketMarket = {
    ...udvardyMertensPolymarket,
    conditionId: 'pm-udvardy-mertens-set-one',
    question: 'Set 1 Winner: Udvardy vs Mertens',
    marketSlug: 'udvardy-mertens-set-1-winner'
  };
  const firstPeriodSx: SxMarket = {
    ...udvardyMertensSx,
    market_hash: 'sx-udvardy-mertens-first-period',
    market_type: 202,
    outcome_one_name: 'Panna Udvardy (1st Period)',
    outcome_two_name: 'Elise Mertens (1st Period)',
    raw: {
      ...(udvardyMertensSx.raw as Record<string, unknown>),
      type: 202,
      marketHash: 'sx-udvardy-mertens-first-period',
      outcomeOneName: 'Panna Udvardy (1st Period)',
      outcomeTwoName: 'Elise Mertens (1st Period)'
    }
  };
  const secondPeriodSx: SxMarket = {
    ...udvardyMertensSx,
    market_hash: 'sx-udvardy-mertens-second-period',
    market_type: 203,
    outcome_one_name: 'Panna Udvardy (2nd Period)',
    outcome_two_name: 'Elise Mertens (2nd Period)',
    raw: {
      ...(udvardyMertensSx.raw as Record<string, unknown>),
      type: 203,
      marketHash: 'sx-udvardy-mertens-second-period',
      outcomeOneName: 'Panna Udvardy (2nd Period)',
      outcomeTwoName: 'Elise Mertens (2nd Period)'
    }
  };

  const result = matchMarkets(
    [udvardyMertensPolymarket, matchTotal, setOneWinner],
    [udvardyMertensSx, firstPeriodSx, secondPeriodSx],
    { minScore: 0.78, reviewScore: 0.66 }
  );
  const fullMatch = result.matches.find(
    (match) => match.polymarketId === udvardyMertensPolymarket.conditionId
  );

  assert.equal(fullMatch?.sxMarketHash, udvardyMertensSx.market_hash);
  assert.equal(fullMatch?.reasons.polymarketSegment, 'full');
  assert.equal(fullMatch?.reasons.sxSegment, 'full');
  assert.equal(fullMatch?.reasons.polymarketMarketType, 'moneyline');
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === matchTotal.conditionId), false);
  assert.equal(
    result.allCandidates.some(
      (candidate) =>
        candidate.polymarketId === setOneWinner.conditionId &&
        candidate.sxMarketHash === udvardyMertensSx.market_hash
    ),
    false
  );
}

{
  const result = matchMarkets(
    [udvardyMertensSetHandicapPolymarket],
    [udvardyMertensSetHandicapSx],
    { minScore: 0.78, reviewScore: 0.66 }
  );
  const match = result.matches[0];

  assert.equal(result.stats.candidateCount, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(match?.polymarketId, '0x77fba3c1e43fc92cd4527983e1fe44c019f4408bfa80b7929d395c43eaad5631');
  assert.equal(match?.sxMarketHash, '0x87509c0ba9ba79821c0177cb9e719709c688a3084993bf75bb9fcbcbfa696f7a');
  assert.equal(match?.confidence, 'high');
  assert.equal(match?.reasons.method, 'canonical');
  assert.equal(match?.reasons.polymarketMarketType, 'spread');
  assert.equal(match?.reasons.sxMarketType, 'spread');
  assert.equal(match?.reasons.polymarketLine, -1.5);
  assert.equal(match?.reasons.sxLine, 1.5);
  assert.equal(match?.reasons.polymarketCanonicalMarketKey, 'spread:1.5');
  assert.equal(match?.reasons.sxCanonicalMarketKey, 'spread:1.5');
  assert.equal(match?.reasons.polymarketSide, 'away');
  assert.equal(match?.reasons.sxSide, 'home');
  assert.equal(match?.reasons.polymarketSegment, 'full');
  assert.equal(match?.reasons.sxSegment, 'full');
  assert.deepEqual(match?.reasons.tokenMapping?.summary, ['pm_token1=sx_token0', 'pm_token0=sx_token1']);
  assert.equal(match?.componentScores.event, 1);
  assert.equal(match?.componentScores.line, 1);
  assert.ok((match?.score ?? 0) >= 0.96);
}

{
  const vacherotCilicSetHandicap: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-vacherot-cilic-set-handicap',
    question: 'Set Handicap: Vacherot (-1.5) vs Cilic (+1.5)',
    marketSlug: 'atp-vacherot-cilic-2026-05-09-set-handicap',
    description: 'Valentin Vacherot vs Marin Cilic',
    tags: 'Sports,Tennis,ATP',
    gameStartTime: '2026-05-09T10:00:00.000Z'
  };
  const wrongOpponent: SxMarket = {
    market_hash: 'sx-cilic-landaluce-set-handicap',
    status: 'active',
    team_one_name: 'Marin Cilic',
    team_two_name: 'Martin Landaluce',
    outcome_one_name: 'Marin Cilic -1.5 (sets)',
    outcome_two_name: 'Martin Landaluce +1.5 (sets)',
    outcome_void_name: 'NO_GAME_OR_EVEN',
    market_type: 866,
    line: -1.5,
    game_time_at: '2026-05-09T10:00:00.000Z',
    sport_label: 'Tennis',
    league_label: 'ATP Rome'
  };
  const correctOpponent: SxMarket = {
    ...wrongOpponent,
    market_hash: 'sx-cilic-vacherot-set-handicap',
    team_two_name: 'Valentin Vacherot',
    outcome_one_name: 'Marin Cilic +1.5 (sets)',
    outcome_two_name: 'Valentin Vacherot -1.5 (sets)',
    line: 1.5
  };
  const result = matchMarkets([vacherotCilicSetHandicap], [wrongOpponent, correctOpponent], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, correctOpponent.market_hash);
  assert.equal(
    result.allCandidates.some((candidate) => candidate.sxMarketHash === wrongOpponent.market_hash),
    false
  );
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-total',
        question: 'Will Lakers vs Celtics total points be over 224.5?'
      }
    ],
    [
      {
        ...baseSx,
        market_hash: 'sx-total',
        outcome_one_name: 'Over',
        outcome_two_name: 'Under',
        group1: 'Total Points',
        line: '224.5'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.reasons.polymarketMarketType, 'total');
  assert.equal(result.matches[0]?.reasons.sxMarketType, 'total');
  assert.equal(result.matches[0]?.reasons.canonicalMarketKey, 'total:224.5');
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-strong',
        question: 'Will the Los Angeles Lakers beat the Boston Celtics?'
      },
      {
        ...basePm,
        conditionId: 'pm-weaker',
        marketSlug: 'nba-lakers',
        description: '',
        question: 'Will Lakers win?'
      }
    ],
    [{ ...baseSx, market_hash: 'sx-one-to-one' }],
    { minScore: 0.7, reviewScore: 0.55, ambiguityGap: 0.01 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, 'pm-strong');
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-soccer-home',
        marketSlug: 'arsenal-chelsea',
        description: 'Arsenal vs Chelsea',
        question: 'Will Arsenal beat Chelsea?',
        gameStartTime: '2026-05-11T18:00:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-arsenal-home',
        status: 'active',
        team_one_name: 'Arsenal FC',
        team_two_name: 'Chelsea FC',
        outcome_one_name: 'Arsenal FC',
        outcome_two_name: 'No',
        market_type: 1,
        game_time_at: '2026-05-11T18:00:00.000Z',
        sport_label: 'Soccer',
        league_label: 'EPL'
      },
      {
        market_hash: 'sx-chelsea-away',
        status: 'active',
        team_one_name: 'Arsenal FC',
        team_two_name: 'Chelsea FC',
        outcome_one_name: 'Chelsea FC',
        outcome_two_name: 'No',
        market_type: 1,
        game_time_at: '2026-05-11T18:00:00.000Z',
        sport_label: 'Soccer',
        league_label: 'EPL'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, 'sx-arsenal-home');
  assert.equal(result.matches[0]?.reasons.canonicalMarketKey, '1x2:home');
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-cerro-win',
        marketSlug: 'lib-pal-cep-2026-05-20-cep',
        description: 'Palmeiras SP vs Cerro Porteño',
        question: 'Will Club Cerro Porteño win on 2026-05-20?',
        gameStartTime: '2026-05-21T00:30:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-cerro-not-cerro',
        status: 'active',
        team_one_name: 'Palmeiras SP',
        team_two_name: 'Cerro Porteño',
        outcome_one_name: 'Cerro Porteño',
        outcome_two_name: 'Not Cerro Porteño',
        outcome_void_name: 'NO_CONTEST',
        market_type: 1,
        game_time_at: '2026-05-21T00:30:00.000Z',
        sport_label: 'Soccer',
        league_label: 'Copa Libertadores'
      },
      {
        market_hash: 'sx-palmeiras-cerro-two-way',
        status: 'active',
        team_one_name: 'Palmeiras SP',
        team_two_name: 'Cerro Porteño',
        outcome_one_name: 'Palmeiras SP',
        outcome_two_name: 'Cerro Porteño',
        outcome_void_name: 'NO_CONTEST',
        market_type: 52,
        game_time_at: '2026-05-21T00:30:00.000Z',
        sport_label: 'Soccer',
        league_label: 'Copa Libertadores'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, 'sx-cerro-not-cerro');
  assert.equal(result.matches[0]?.reasons.polymarketCanonicalMarketKey, '1x2:away');
  assert.equal(result.matches[0]?.reasons.sxCanonicalMarketKey, '1x2:away');
  assert.ok((result.matches[0]?.reasons.ambiguityMargin ?? 0) >= 0.03);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-low-event-cerro-win',
        marketSlug: 'lib-pal-cep-2026-05-20-cep',
        description: null,
        question: 'Will Club Cerro Porteño win on 2026-05-20?',
        tags: 'Sports,Soccer,Copa Libertadores',
        gameStartTime: '2026-05-21T00:30:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-low-event-cerro-not-cerro',
        status: 'active',
        team_one_name: 'Palmeiras SP',
        team_two_name: 'Cerro Porteño',
        outcome_one_name: 'Cerro Porteño',
        outcome_two_name: 'Not Cerro Porteño',
        outcome_void_name: 'NO_CONTEST',
        market_type: 1,
        game_time_at: '2026-05-21T00:30:00.000Z',
        sport_label: 'Soccer',
        league_label: 'Copa Libertadores'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6, minEventScore: 0.9 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, 'sx-low-event-cerro-not-cerro');
  assert.equal(result.matches[0]?.reasons.polymarketSide, 'away');
  assert.ok((result.matches[0]?.componentScores.event ?? 1) < 0.9);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-middlesbrough-win',
        marketSlug: 'eng-middlesbrough-south-2026-05-09-win',
        description: null,
        question: 'Will Middlesbrough FC win on 2026-05-09?',
        tags: 'Sports,Soccer',
        gameStartTime: '2026-05-09T14:00:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-middlesbrough-not-middlesbrough',
        status: 'active',
        team_one_name: 'Middlesbrough',
        team_two_name: 'Southampton',
        outcome_one_name: 'Middlesbrough',
        outcome_two_name: 'Not Middlesbrough',
        outcome_void_name: 'NO_CONTEST',
        market_type: 1,
        game_time_at: '2026-05-09T14:00:00.000Z',
        sport_label: 'Soccer',
        league_label: 'The Championship'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6, minEventScore: 0.9 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, 'sx-middlesbrough-not-middlesbrough');
  assert.ok((result.matches[0]?.componentScores.event ?? 1) < 0.9);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-fc-seoul-win',
        marketSlug: 'fc-seoul-2026-05-09-win',
        description: null,
        question: 'Will FC Seoul win on 2026-05-09?',
        tags: 'Sports,Soccer,K League',
        gameStartTime: '2026-05-09T07:30:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-seoul-eland-not-seoul-eland',
        status: 'active',
        team_one_name: 'Chungnam Asan FC',
        team_two_name: 'Seoul E-Land FC',
        outcome_one_name: 'Seoul E-Land FC',
        outcome_two_name: 'Not Seoul E-Land FC',
        outcome_void_name: 'NO_CONTEST',
        market_type: 1,
        game_time_at: '2026-05-09T07:30:00.000Z',
        sport_label: 'Soccer',
        league_label: 'K League'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6, minEventScore: 0.9 }
  );

  assert.equal(result.matches.length, 0);
  assert.equal(result.stats.candidateCount, 0);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-san-diego-wave-win',
        marketSlug: 'nwsl-san-diego-wave-2026-05-09-win',
        description: null,
        question: 'Will San Diego Wave FC win on 2026-05-09?',
        tags: 'Sports,Soccer,NWSL',
        gameStartTime: '2026-05-10T00:45:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-seattle-san-diego-fc',
        status: 'active',
        team_one_name: 'Seattle Sounders',
        team_two_name: 'San Diego FC',
        outcome_one_name: 'San Diego FC',
        outcome_two_name: 'Not San Diego FC',
        outcome_void_name: 'NO_CONTEST',
        market_type: 1,
        game_time_at: '2026-05-10T02:30:00.000Z',
        sport_label: 'Soccer',
        league_label: 'Major League Soccer'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6, minEventScore: 0.9 }
  );

  assert.equal(result.matches.length, 0);
  assert.equal(result.stats.candidateCount, 0);
}

{
  const newcastleUnited: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-newcastle-united-win',
    marketSlug: 'epl-newcastle-united-nottingham-2026-05-10-newcastle',
    description: null,
    question: 'Will Newcastle United FC win on 2026-05-10?',
    tags: 'Sports,Soccer,EPL',
    gameStartTime: '2026-05-10T13:00:00.000Z'
  };
  const newcastleRedBulls: PolymarketMarket = {
    ...newcastleUnited,
    conditionId: 'pm-newcastle-red-bulls-win',
    marketSlug: 'newcastle-red-bulls-2026-05-10-win',
    question: 'Will Newcastle Red Bulls win?'
  };
  const sx: SxMarket = {
    market_hash: 'sx-nottingham-newcastle-united',
    status: 'active',
    team_one_name: 'Nottingham Forest',
    team_two_name: 'Newcastle United',
    outcome_one_name: 'Newcastle United',
    outcome_two_name: 'Not Newcastle United',
    outcome_void_name: 'NO_CONTEST',
    market_type: 1,
    game_time_at: '2026-05-10T13:00:00.000Z',
    sport_label: 'Soccer',
    league_label: 'English Premier League'
  };
  const result = matchMarkets([newcastleUnited, newcastleRedBulls], [sx], {
    minScore: 0.74,
    reviewScore: 0.6,
    minEventScore: 0.9
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, newcastleUnited.conditionId);
  assert.equal(
    result.allCandidates.some((candidate) => candidate.polymarketId === newcastleRedBulls.conditionId),
    false
  );
}

{
  const fullWinPm: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-stade-brestois-win',
    marketSlug: 'fl1-psg-sbr-2026-05-10-sbr',
    description: 'Paris Saint Germain vs Stade Brestois',
    question: 'Will Stade Brestois 29 win on 2026-05-10?',
    gameStartTime: '2026-05-10T19:00:00.000Z'
  };
  const halftimePm: PolymarketMarket = {
    ...fullWinPm,
    conditionId: 'pm-stade-brestois-halftime',
    question: 'Stade Brestois 29 leading at halftime?',
    marketSlug: 'fl1-psg-sbr-2026-05-10-sbr-halftime'
  };
  const sx: SxMarket = {
    market_hash: 'sx-stade-brestois-not-stade',
    status: 'active',
    team_one_name: 'Paris Saint Germain',
    team_two_name: 'Stade Brestois (Brest)',
    outcome_one_name: 'Stade Brestois (Brest)',
    outcome_two_name: 'Not Stade Brestois (Brest)',
    outcome_void_name: 'NO_CONTEST',
    market_type: 1,
    game_time_at: '2026-05-10T19:00:00.000Z',
    sport_label: 'Soccer',
    league_label: 'Ligue 1'
  };
  const result = matchMarkets([fullWinPm, halftimePm], [sx], { minScore: 0.74, reviewScore: 0.6 });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, fullWinPm.conditionId);
  assert.equal(result.matches[0]?.sxMarketHash, sx.market_hash);
  assert.equal(result.matches[0]?.reasons.polymarketSegment, 'full');
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === halftimePm.conditionId), false);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-spread',
        question: 'Will the Lakers cover -3.5 against the Celtics?',
        description: 'Los Angeles Lakers vs Boston Celtics',
        gameStartTime: '2026-05-12T00:00:00.000Z'
      }
    ],
    [
      {
        ...baseSx,
        market_hash: 'sx-spread',
        outcome_one_name: 'Boston Celtics +3.5',
        outcome_two_name: 'Los Angeles Lakers -3.5',
        market_type: 3,
        line: '3.5',
        game_time_at: '2026-05-12T00:00:00.000Z'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, 'sx-spread');
  assert.equal(result.matches[0]?.reasons.canonicalMarketKey, 'spread:3.5');
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-btts',
        marketSlug: 'arsenal-chelsea-btts',
        description: 'Arsenal vs Chelsea',
        question: 'Arsenal vs. Chelsea: Both Teams to Score',
        gameStartTime: '2026-05-11T18:00:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-arsenal-home-btts-trap',
        status: 'active',
        team_one_name: 'Arsenal FC',
        team_two_name: 'Chelsea FC',
        outcome_one_name: 'Arsenal FC',
        outcome_two_name: 'Not Arsenal FC',
        market_type: 1,
        game_time_at: '2026-05-11T18:00:00.000Z',
        sport_label: 'Soccer',
        league_label: 'EPL'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.stats.candidateCount, 0);
  assert.equal(result.matches.length, 0);
}

{
  const polymarket: PolymarketMarket = {
    ...basePm,
    conditionId: '0xc29358654c2bd7e2fff20f9f7d242a7f61dd2232c83a69478ee6211fffa1378f',
    question: '1H Spread: Spurs (-1.5)',
    marketSlug: 'nba-spurs-timberwolves-1h-spread-spurs-1pt5',
    description: 'San Antonio Spurs vs Minnesota Timberwolves',
    gameStartTime: '2026-05-10T00:00:00.000Z'
  };
  const firstHalfSx: SxMarket = {
    ...baseSx,
    market_hash: '0xdc667efb3616be4f18ab71323536fd03fc2ab468412a717c250264eaafa67e6c',
    team_one_name: 'Minnesota Timberwolves',
    team_two_name: 'San Antonio Spurs',
    outcome_one_name: 'Minnesota Timberwolves +1.5 (1st half)',
    outcome_two_name: 'San Antonio Spurs -1.5 (1st half)',
    outcome_void_name: 'NO_GAME_OR_EVEN',
    market_type: 53,
    line: '1.5',
    sport_label: 'Basketball',
    league_label: 'NBA'
  };
  const firstQuarterSx: SxMarket = {
    ...firstHalfSx,
    market_hash: '0xe7e6ccc6666c3cefc523526f53590326e285603c260918c84ea7cbc8f8861942',
    outcome_one_name: 'Minnesota Timberwolves +1.5 (1st Period)',
    outcome_two_name: 'San Antonio Spurs -1.5 (1st Period)',
    market_type: 64
  };
  const result = matchMarkets([polymarket], [firstHalfSx, firstQuarterSx], {
    minScore: 0.74,
    reviewScore: 0.6
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, firstHalfSx.market_hash);
  assert.equal(result.matches[0]?.reasons.polymarketSegment, 'half1');
  assert.equal(result.matches[0]?.reasons.sxSegment, 'half1');
  assert.equal(
    result.allCandidates.some((candidate) => candidate.sxMarketHash === firstQuarterSx.market_hash),
    false
  );
}

{
  const polymarket: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-spurs-timberwolves-full',
    question: 'Spurs vs. Timberwolves',
    marketSlug: 'nba-spurs-timberwolves',
    description: 'San Antonio Spurs vs Minnesota Timberwolves',
    gameStartTime: '2026-05-10T00:00:00.000Z'
  };
  const fullGameSx: SxMarket = {
    ...baseSx,
    market_hash: 'sx-spurs-timberwolves-full',
    team_one_name: 'Minnesota Timberwolves',
    team_two_name: 'San Antonio Spurs',
    outcome_one_name: 'Minnesota Timberwolves',
    outcome_two_name: 'San Antonio Spurs',
    outcome_void_name: 'NO_CONTEST',
    market_type: 226,
    sport_label: 'Basketball',
    league_label: 'NBA'
  };
  const thirdQuarterSx: SxMarket = {
    ...fullGameSx,
    market_hash: 'sx-spurs-timberwolves-third-quarter',
    outcome_one_name: 'Minnesota Timberwolves (3rd Period)',
    outcome_two_name: 'San Antonio Spurs (3rd Period)',
    market_type: 204
  };
  const result = matchMarkets([polymarket], [fullGameSx, thirdQuarterSx], {
    minScore: 0.74,
    reviewScore: 0.6
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, fullGameSx.market_hash);
  assert.equal(result.matches[0]?.reasons.polymarketSegment, 'full');
  assert.equal(result.matches[0]?.reasons.sxSegment, 'full');
  assert.equal(
    result.allCandidates.some((candidate) => candidate.sxMarketHash === thirdQuarterSx.market_hash),
    false
  );
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-kc-mkoi-handicap',
        marketSlug: 'lol-mkoi-kc-2026-05-09-game-handicap-home-1pt5',
        question: 'Game Handicap: KC (-1.5) vs Movistar KOI (+1.5)',
        description:
          'This market refers to the LoL match between Movistar KOI and Karmine Corp in the LEC Regular Season.',
        tags: 'Sports,Esports,league of legends,Games',
        gameStartTime: '2026-05-09T17:00:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-karmine-g2-trap',
        status: 'active',
        team_one_name: 'Karmine Corp Gc',
        team_two_name: 'G2 Esports',
        outcome_one_name: 'Karmine Corp Gc -1.5',
        outcome_two_name: 'G2 Esports +1.5',
        outcome_void_name: 'NO_GAME_OR_EVEN',
        market_type: 3,
        line: '-1.5',
        game_time_at: '2026-05-08T14:00:00.000Z',
        sport_label: 'Esports',
        league_label: 'LOL - LEC'
      },
      {
        market_hash: 'sx-movistar-karmine-handicap',
        status: 'active',
        team_one_name: 'Movistar Koi',
        team_two_name: 'Karmine Corp Gc',
        outcome_one_name: 'Movistar Koi +1.5',
        outcome_two_name: 'Karmine Corp Gc -1.5',
        outcome_void_name: 'NO_GAME_OR_EVEN',
        market_type: 3,
        line: '1.5',
        game_time_at: '2026-05-09T17:00:00.000Z',
        sport_label: 'Esports',
        league_label: 'LOL - LEC'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, 'sx-movistar-karmine-handicap');
  assert.equal(result.matches[0]?.componentScores.event, 1);
  assert.equal(result.matches[0]?.componentScores.line, 1);
  assert.equal(result.allCandidates.some((candidate) => candidate.sxMarketHash === 'sx-karmine-g2-trap'), false);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-spread-opposite-sign',
        question: 'Spread: Los Angeles Lakers (-3.5)',
        description: 'Los Angeles Lakers vs Boston Celtics',
        gameStartTime: '2026-05-12T00:00:00.000Z'
      }
    ],
    [
      {
        ...baseSx,
        market_hash: 'sx-spread-opposite-sign',
        outcome_one_name: 'Los Angeles Lakers +3.5',
        outcome_two_name: 'Boston Celtics -3.5',
        market_type: 3,
        line: '3.5',
        game_time_at: '2026-05-12T00:00:00.000Z'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.stats.candidateCount, 0);
  assert.equal(result.matches.length, 0);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-full-game-total',
        marketSlug: 'mlb-diamondbacks-pirates-total',
        question: 'Pittsburgh Pirates vs. Arizona Diamondbacks: O/U 4.5',
        description: 'Pittsburgh Pirates vs Arizona Diamondbacks',
        gameStartTime: '2026-05-07T01:40:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-first-five-total',
        status: 'active',
        team_one_name: 'Arizona Diamondbacks',
        team_two_name: 'Pittsburgh Pirates',
        outcome_one_name: 'Over 4.5 (1st 5 Innings)',
        outcome_two_name: 'Under 4.5 (1st 5 Innings)',
        outcome_void_name: 'NO_GAME_OR_EVEN',
        market_type: 236,
        line: '4.5',
        game_time_at: '2026-05-07T01:40:00.000Z',
        sport_label: 'Baseball',
        league_label: 'MLB'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.stats.candidateCount, 0);
  assert.equal(result.matches.length, 0);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-toronto-miami-total',
        marketSlug: 'toronto-fc-inter-miami-ou-2-5',
        question: 'Toronto FC vs. Inter Miami CF: O/U 2.5',
        description: 'Toronto FC vs Inter Miami CF',
        tags: 'Sports,Soccer,MLS',
        gameStartTime: '2026-05-09T17:00:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-winterthur-lausanne-total',
        status: 'active',
        team_one_name: 'FC Winterthur',
        team_two_name: 'FC Lausanne-Sport',
        outcome_one_name: 'Over 2.5',
        outcome_two_name: 'Under 2.5',
        outcome_void_name: 'NO_GAME_OR_EVEN',
        market_type: 2,
        line: '2.5',
        game_time_at: '2026-05-09T16:00:00.000Z',
        sport_label: 'Soccer',
        league_label: 'Swiss Super League'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.stats.candidateCount, 0);
  assert.equal(result.matches.length, 0);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-total-mismatch',
        question: 'Will Lakers vs Celtics total points be over 224.5?'
      }
    ],
    [
      {
        ...baseSx,
        market_hash: 'sx-total-wrong-line',
        outcome_one_name: 'Over',
        outcome_two_name: 'Under',
        group1: 'Total Points',
        line: '229.5'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.matches.length, 0);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-total-half-point-mismatch',
        question: 'Will Lakers vs Celtics total points be over 224.5?'
      }
    ],
    [
      {
        ...baseSx,
        market_hash: 'sx-total-half-point-mismatch',
        outcome_one_name: 'Over',
        outcome_two_name: 'Under',
        group1: 'Total Points',
        line: '224'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.stats.candidateCount, 0);
  assert.equal(result.matches.length, 0);
}

{
  const targetPm: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-wnba-valkyries-storm',
    question: 'Golden State Valkyries vs. Seattle Storm',
    marketSlug: 'wnba-gsv-sea-2026-05-08',
    description: 'If the Golden State Valkyries win, this resolves to Golden State Valkyries. If the Seattle Storm win, this resolves to Seattle Storm.',
    tags: 'Sports,WNBA,Games',
    gameStartTime: '2026-05-09T02:00:00.000Z'
  };
  const falsePm: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-nhl-golden-knights-ducks',
    question: 'Golden Knights vs. Ducks',
    marketSlug: 'nhl-las-ana-2026-05-08',
    description: 'If the Golden Knights win, this resolves to Golden Knights. If the Ducks win, this resolves to Ducks.',
    tags: 'Sports,NHL,Hockey,Games',
    gameStartTime: '2026-05-09T01:30:00.000Z'
  };
  const sx: SxMarket = {
    market_hash: 'sx-wnba-valkyries-storm',
    status: 'active',
    team_one_name: 'Seattle Storm W',
    team_two_name: 'Golden State Valkyries W',
    outcome_one_name: 'Seattle Storm W',
    outcome_two_name: 'Golden State Valkyries W',
    outcome_void_name: 'NO_CONTEST',
    market_type: 226,
    game_time_at: '2026-05-09T02:00:00.000Z',
    sport_label: 'Basketball',
    league_label: 'WNBA'
  };
  const result = matchMarkets([targetPm, falsePm], [sx], { minScore: 0.74, reviewScore: 0.6 });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, targetPm.conditionId);
  assert.equal(result.matches[0]?.sxMarketHash, sx.market_hash);
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === falsePm.conditionId), false);
}

{
  const fullGamePm: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-mlb-pirates-diamondbacks',
    question: 'Pittsburgh Pirates vs. Arizona Diamondbacks',
    marketSlug: 'mlb-pit-ari-2026-05-07',
    description: 'If the Pittsburgh Pirates win, this resolves to Pittsburgh Pirates. If the Arizona Diamondbacks win, this resolves to Arizona Diamondbacks.',
    tags: 'Sports,MLB,Baseball,Games',
    gameStartTime: '2026-05-07T19:40:00.000Z'
  };
  const firstInningPropPm: PolymarketMarket = {
    ...fullGamePm,
    conditionId: 'pm-mlb-first-inning-run',
    question: 'Will there be a run scored in the first inning?: Pittsburgh Pirates vs. Arizona Diamondbacks',
    marketSlug: 'mlb-pit-ari-2026-05-07-first-inning-run'
  };
  const sx: SxMarket = {
    market_hash: 'sx-mlb-pirates-diamondbacks',
    status: 'active',
    team_one_name: 'Arizona Diamondbacks',
    team_two_name: 'Pittsburgh Pirates',
    outcome_one_name: 'Arizona Diamondbacks',
    outcome_two_name: 'Pittsburgh Pirates',
    outcome_void_name: 'NO_CONTEST',
    market_type: 226,
    game_time_at: '2026-05-07T19:40:00.000Z',
    sport_label: 'Baseball',
    league_label: 'MLB'
  };
  const result = matchMarkets([fullGamePm, firstInningPropPm], [sx], { minScore: 0.74, reviewScore: 0.6 });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, fullGamePm.conditionId);
  assert.equal(result.matches[0]?.sxMarketHash, sx.market_hash);
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === firstInningPropPm.conditionId), false);
}

{
  const cerroSpread: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-cerro-spread-wrong-side',
    question: 'Spread: Club Cerro Porteño (-2.5)',
    marketSlug: 'lib-pal-cep-2026-05-20-spread-cep-minus-2pt5',
    description:
      'This market resolves to Club Cerro Porteño if Club Cerro Porteño win by 3 or more goals. Otherwise, this market resolves to SE Palmeiras.',
    gameStartTime: '2026-05-21T00:30:00.000Z'
  };
  const palmeirasSpread: PolymarketMarket = {
    ...cerroSpread,
    conditionId: 'pm-palmeiras-spread-right-side',
    question: 'Spread: SE Palmeiras (-2.5)',
    marketSlug: 'lib-pal-cep-2026-05-20-spread-pal-minus-2pt5',
    description:
      'This market resolves to SE Palmeiras if SE Palmeiras win by 3 or more goals. Otherwise, this market resolves to Club Cerro Porteño.'
  };
  const sx: SxMarket = {
    market_hash: 'sx-palmeiras-minus-2pt5',
    status: 'active',
    team_one_name: 'Palmeiras SP',
    team_two_name: 'Cerro Porteño',
    outcome_one_name: 'Palmeiras SP -2.5',
    outcome_two_name: 'Cerro Porteño +2.5',
    outcome_void_name: 'NO_GAME_OR_EVEN',
    market_type: 3,
    line: '-2.5',
    game_time_at: '2026-05-21T00:30:00.000Z',
    sport_label: 'Soccer',
    league_label: 'Copa Libertadores'
  };
  const result = matchMarkets([cerroSpread, palmeirasSpread], [sx], { minScore: 0.74, reviewScore: 0.6 });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, palmeirasSpread.conditionId);
  assert.equal(result.matches[0]?.sxMarketHash, sx.market_hash);
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === cerroSpread.conditionId), false);
}

{
  const rosarioWin: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-rosario-win',
    question: 'Will CA Rosario Central win on 2026-05-19?',
    marketSlug: 'lib-ros-ucv-2026-05-19-ros',
    description: 'Rosario Central vs Universidad Central de Venezuela FC',
    gameStartTime: '2026-05-19T22:00:00.000Z'
  };
  const ucvWin: PolymarketMarket = {
    ...rosarioWin,
    conditionId: 'pm-ucv-win',
    question: 'Will Universidad Central de Venezuela FC win on 2026-05-19?',
    marketSlug: 'lib-ros-ucv-2026-05-19-ucv'
  };
  const sx: SxMarket = {
    market_hash: 'sx-rosario-not-rosario',
    status: 'active',
    team_one_name: 'Rosario Central',
    team_two_name: 'UCV FC',
    outcome_one_name: 'Rosario Central',
    outcome_two_name: 'Not Rosario Central',
    outcome_void_name: 'NO_CONTEST',
    market_type: 1,
    game_time_at: '2026-05-19T22:00:00.000Z',
    sport_label: 'Soccer',
    league_label: 'Copa Libertadores'
  };
  const result = matchMarkets([rosarioWin, ucvWin], [sx], { minScore: 0.74, reviewScore: 0.6 });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, rosarioWin.conditionId);
  assert.equal(result.matches[0]?.sxMarketHash, sx.market_hash);
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === ucvWin.conditionId), false);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-anytime-goalscorer',
        question: 'Florian Neuhaus: Anytime Goalscorer',
        marketSlug: 'bundesliga-augsburg-monchengladbach-neuhaus-goalscorer',
        description: 'FC Augsburg vs Borussia Monchengladbach',
        tags: 'Sports,Soccer,Bundesliga',
        gameStartTime: '2026-05-09T13:30:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-augsburg-monchengladbach-moneyline',
        status: 'active',
        team_one_name: 'FC Augsburg',
        team_two_name: 'Borussia Monchengladbach',
        outcome_one_name: 'FC Augsburg',
        outcome_two_name: 'Borussia Monchengladbach',
        outcome_void_name: 'NO_CONTEST',
        market_type: 52,
        game_time_at: '2026-05-09T13:30:00.000Z',
        sport_label: 'Soccer',
        league_label: 'Bundesliga'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.stats.candidateCount, 0);
  assert.equal(result.matches.length, 0);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-numbered-club-spread',
        question: 'Spread: 1. FC Köln (-1.5)',
        marketSlug: 'bundesliga-koln-heidenheim-spread-koln-minus-1pt5',
        description: '1. FC Koln vs 1. FC Heidenheim 1846',
        gameStartTime: '2026-05-10T15:30:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-koln-wrong-line',
        status: 'active',
        team_one_name: '1. FC Koln',
        team_two_name: '1. FC Heidenheim 1846',
        outcome_one_name: '1. FC Koln +1',
        outcome_two_name: '1. FC Heidenheim 1846 -1',
        outcome_void_name: 'NO_GAME_OR_EVEN',
        market_type: 3,
        line: '1',
        game_time_at: '2026-05-10T15:30:00.000Z',
        sport_label: 'Soccer',
        league_label: 'Bundesliga'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.stats.candidateCount, 0);
  assert.equal(result.matches.length, 0);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-numbered-club-total',
        question: 'BV Borussia 09 Dortmund vs. Eintracht Frankfurt: O/U 7.5 Total Corners',
        marketSlug: 'bundesliga-dortmund-frankfurt-total-corners-7pt5',
        description: 'Borussia Dortmund vs Eintracht Frankfurt',
        gameStartTime: '2026-05-08T18:30:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-dortmund-wrong-total-line',
        status: 'active',
        team_one_name: 'Borussia Dortmund',
        team_two_name: 'Eintracht Frankfurt',
        outcome_one_name: 'Over 9.0',
        outcome_two_name: 'Under 9.0',
        outcome_void_name: 'NO_GAME_OR_EVEN',
        market_type: 2,
        line: '9',
        game_time_at: '2026-05-08T18:30:00.000Z',
        sport_label: 'Soccer',
        league_label: 'Bundesliga'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.stats.candidateCount, 0);
  assert.equal(result.matches.length, 0);
}

{
  const result = matchMarkets(
    [
      {
        ...basePm,
        conditionId: 'pm-esports-odd-even-kills',
        question: 'Game 1: Odd/Even Total Kills?',
        marketSlug: 'lol-shopify-sentinels-game-1-odd-even-kills',
        description: 'Shopify Rebellion vs Sentinels',
        tags: 'Sports,Esports,League of Legends',
        gameStartTime: '2026-05-09T20:00:00.000Z'
      }
    ],
    [
      {
        market_hash: 'sx-shopify-sentinels-moneyline',
        status: 'active',
        team_one_name: 'Shopify Rebellion',
        team_two_name: 'Sentinels',
        outcome_one_name: 'Shopify Rebellion',
        outcome_two_name: 'Sentinels',
        outcome_void_name: 'NO_CONTEST',
        market_type: 52,
        game_time_at: '2026-05-09T20:00:00.000Z',
        sport_label: 'E Sports',
        league_label: 'LOL - LCS'
      }
    ],
    { minScore: 0.74, reviewScore: 0.6 }
  );

  assert.equal(result.stats.candidateCount, 0);
  assert.equal(result.matches.length, 0);
}

{
  const fullMatch: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-ipl-delhi-kolkata',
    question: 'Indian Premier League: Delhi Capitals vs Kolkata Knight Riders',
    marketSlug: 'ipl-delhi-kolkata-2026-05-08',
    description: 'Delhi Capitals vs Kolkata Knight Riders',
    tags: 'Sports,Cricket,Indian Premier League',
    gameStartTime: '2026-05-08T14:00:00.000Z'
  };
  const tossProp: PolymarketMarket = {
    ...fullMatch,
    conditionId: 'pm-ipl-delhi-kolkata-toss',
    question: 'Indian Premier League: Delhi Capitals vs Kolkata Knight Riders - Toss Match Double Delhi Capitals Winner',
    marketSlug: 'ipl-delhi-kolkata-toss-match-double-delhi'
  };
  const sx: SxMarket = {
    market_hash: 'sx-ipl-delhi-kolkata',
    status: 'active',
    team_one_name: 'Delhi Capitals',
    team_two_name: 'Kolkata Knight Riders',
    outcome_one_name: 'Delhi Capitals',
    outcome_two_name: 'Kolkata Knight Riders',
    outcome_void_name: 'NO_CONTEST',
    market_type: 52,
    game_time_at: '2026-05-08T14:00:00.000Z',
    sport_label: 'Cricket',
    league_label: 'Indian Premier League'
  };
  const result = matchMarkets([fullMatch, tossProp], [sx], { minScore: 0.74, reviewScore: 0.6 });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, fullMatch.conditionId);
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === tossProp.conditionId), false);
}

{
  const seriesWinner: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-lol-series',
    question: 'LoL: Shopify Rebellion vs Sentinels (BO3) - LCS Regular Season',
    marketSlug: 'lol-shopify-rebellion-sentinels-bo3-lcs',
    description: 'This market refers to the LoL match between Shopify Rebellion and Sentinels in the LCS.',
    tags: 'Sports,Esports,League of Legends',
    gameStartTime: '2026-05-09T20:00:00.000Z'
  };
  const gameOneWinner: PolymarketMarket = {
    ...seriesWinner,
    conditionId: 'pm-lol-game-one',
    question: 'LoL: Shopify Rebellion vs Sentinels - Game 1 Winner',
    marketSlug: 'lol-shopify-rebellion-sentinels-game-1-winner'
  };
  const dragonProp: PolymarketMarket = {
    ...seriesWinner,
    conditionId: 'pm-lol-dragon',
    question: 'Game 1: Both Teams Slay a Dragon?',
    marketSlug: 'lol-shopify-rebellion-sentinels-game-1-both-teams-slay-dragon'
  };
  const sx: SxMarket = {
    market_hash: 'sx-lol-series',
    status: 'active',
    team_one_name: 'Shopify Rebellion',
    team_two_name: 'Sentinels',
    outcome_one_name: 'Shopify Rebellion',
    outcome_two_name: 'Sentinels',
    outcome_void_name: 'NO_CONTEST',
    market_type: 52,
    game_time_at: '2026-05-09T20:00:00.000Z',
    sport_label: 'E Sports',
    league_label: 'LOL - LCS'
  };
  const result = matchMarkets([seriesWinner, gameOneWinner, dragonProp], [sx], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, seriesWinner.conditionId);
  assert.equal(result.matches[0]?.sxMarketHash, sx.market_hash);
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === gameOneWinner.conditionId), false);
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === dragonProp.conditionId), false);
}

{
  const setHandicap: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-tennis-set-handicap',
    question: 'Set Handicap: Agut (-1.5) vs Maestrelli (+1.5)',
    marketSlug: 'tennis-agut-maestrelli-set-handicap',
    description: 'Roberto Bautista Agut vs Francesco Maestrelli',
    tags: 'Sports,Tennis',
    gameStartTime: '2026-05-07T10:00:00.000Z'
  };
  const sxSetHandicap: SxMarket = {
    market_hash: 'sx-tennis-set-handicap',
    status: 'active',
    team_one_name: 'Roberto Bautista Agut',
    team_two_name: 'Francesco Maestrelli',
    outcome_one_name: 'Roberto Bautista Agut -1.5 (sets)',
    outcome_two_name: 'Francesco Maestrelli +1.5 (sets)',
    outcome_void_name: 'NO_GAME_OR_EVEN',
    market_type: 866,
    line: -1.5,
    game_time_at: '2026-05-07T10:00:00.000Z',
    sport_label: 'Tennis',
    league_label: 'ATP Rome'
  };
  const sxPlainHandicap: SxMarket = {
    ...sxSetHandicap,
    market_hash: 'sx-tennis-plain-handicap',
    market_type: 201,
    outcome_one_name: 'Roberto Bautista Agut -1.5',
    outcome_two_name: 'Francesco Maestrelli +1.5'
  };
  const result = matchMarkets([setHandicap], [sxPlainHandicap, sxSetHandicap], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, sxSetHandicap.market_hash);
  assert.equal(result.allCandidates.some((candidate) => candidate.sxMarketHash === sxPlainHandicap.market_hash), false);
}

{
  const moneyline: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-ufc-moneyline',
    question: 'UFC 328: Pat Sabatini vs. William Gomis (Featherweight, Early Prelims)',
    marketSlug: 'ufc-pat2-wil5-2026-05-09',
    description:
      'This market will resolve to "Pat Sabatini" if Pat Sabatini is officially declared the winner of the fight against William Gomis at UFC 328: Chimaev vs. Strickland, scheduled for May 9, 2026.',
    tags: 'Sports,UFC',
    gameStartTime: '2026-05-09T22:00:00.000Z'
  };
  const methodProp: PolymarketMarket = {
    ...moneyline,
    conditionId: 'pm-ufc-ko-prop',
    question: 'Will the fight be won by KO or TKO?',
    marketSlug: 'ufc-pat2-wil5-2026-05-09-win-by-ko-tko',
    description:
      'This market will resolve to "Yes" if the fight between Pat Sabatini and William Gomis at UFC 328: Chimaev vs. Strickland, scheduled for May 9, 2026, ends by KO or TKO.'
  };
  const actualSx: SxMarket = {
    market_hash: 'sx-ufc-pat-gomis',
    status: 'active',
    team_one_name: 'Pat Sabatini',
    team_two_name: 'William Gomis',
    outcome_one_name: 'Pat Sabatini',
    outcome_two_name: 'William Gomis',
    outcome_void_name: 'NO_CONTEST',
    market_type: 52,
    game_time_at: '2026-05-09T22:00:00.000Z',
    sport_label: 'Mixed Martial Arts',
    league_label: 'UFC'
  };
  const eventTitleSx: SxMarket = {
    ...actualSx,
    market_hash: 'sx-ufc-chimaev-strickland',
    team_one_name: 'Khamzat Chimaev',
    team_two_name: 'Sean Strickland',
    outcome_one_name: 'Khamzat Chimaev',
    outcome_two_name: 'Sean Strickland'
  };
  const result = matchMarkets([moneyline, methodProp], [eventTitleSx, actualSx], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, moneyline.conditionId);
  assert.equal(result.matches[0]?.sxMarketHash, actualSx.market_hash);
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === methodProp.conditionId), false);
  assert.equal(result.allCandidates.some((candidate) => candidate.sxMarketHash === eventTitleSx.market_hash), false);
}

{
  const roundsTotal: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-ufc-rounds-total',
    question: 'O/U 2.5 Rounds',
    marketSlug: 'ufc-djo-bai1-2026-05-09-totals-2pt5',
    description:
      'Each market will resolve to "Over" if the fight between Djorden Santos and Baisangur Susurkaev at UFC 328: Chimaev vs. Strickland, scheduled for May 9, 2026, lasts beyond the listed round threshold.',
    tags: 'Sports,UFC',
    gameStartTime: '2026-05-09T22:00:00.000Z'
  };
  const actualSx: SxMarket = {
    market_hash: 'sx-ufc-djorden-baisangur-rounds',
    status: 'active',
    team_one_name: 'Baysangur Susurkaev',
    team_two_name: 'Djorden Santos',
    outcome_one_name: 'Over 2.5',
    outcome_two_name: 'Under 2.5',
    outcome_void_name: 'NO_GAME_OR_EVEN',
    market_type: 29,
    line: 2.5,
    game_time_at: '2026-05-09T22:00:00.000Z',
    sport_label: 'Mixed Martial Arts',
    league_label: 'UFC'
  };
  const eventTitleSx: SxMarket = {
    ...actualSx,
    market_hash: 'sx-ufc-chimaev-strickland-rounds',
    team_one_name: 'Khamzat Chimaev',
    team_two_name: 'Sean Strickland'
  };
  const result = matchMarkets([roundsTotal], [eventTitleSx, actualSx], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, actualSx.market_hash);
  assert.equal(result.allCandidates.some((candidate) => candidate.sxMarketHash === eventTitleSx.market_hash), false);
}

{
  const heerenveenWin: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-heerenveen-win',
    question: 'Will SC Heerenveen win on 2026-05-10?',
    marketSlug: 'ere-nac-her1-2026-05-10-her1',
    description: 'NAC Breda vs SC Heerenveen',
    tags: 'Sports,Soccer,Games,Eredivisie',
    gameStartTime: '2026-05-10T12:30:00.000Z'
  };
  const teamNotTeam: SxMarket = {
    market_hash: 'sx-heerenveen-not-heerenveen',
    status: 'active',
    team_one_name: 'NAC Breda',
    team_two_name: 'SC Heerenveen',
    outcome_one_name: 'SC Heerenveen',
    outcome_two_name: 'Not SC Heerenveen',
    outcome_void_name: 'NO_CONTEST',
    market_type: 1,
    game_time_at: '2026-05-10T12:30:00.000Z',
    sport_label: 'Soccer',
    league_label: 'Netherlands - Eredivisie'
  };
  const twoWay: SxMarket = {
    ...teamNotTeam,
    market_hash: 'sx-heerenveen-two-way',
    outcome_one_name: 'NAC Breda',
    outcome_two_name: 'SC Heerenveen',
    market_type: 52
  };
  const result = matchMarkets([heerenveenWin], [twoWay, teamNotTeam], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, teamNotTeam.market_hash);
  assert.equal(result.matches[0]?.reasons.sxCanonicalMarketKey, '1x2:away');
}

{
  const unionWin: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-union-berlin-win',
    question: 'Will 1. FC Union Berlin win on 2026-05-10?',
    marketSlug: 'bun-mai-uni-2026-05-10-uni',
    description: 'FSV Mainz vs Union Berlin',
    tags: 'Sports,bundesliga,Soccer,Games',
    gameStartTime: '2026-05-10T13:30:00.000Z'
  };
  const albaBasketball: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-alba-jena',
    question: 'Alba Berlin vs. Science City Jena',
    marketSlug: 'bkbbl-alb-sci-2026-05-10',
    description: 'Alba Berlin vs Science City Jena',
    tags: 'Sports,Basketball,Games,Germany BBL',
    gameStartTime: '2026-05-10T14:30:00.000Z'
  };
  const unionSx: SxMarket = {
    market_hash: 'sx-union-berlin-not-union',
    status: 'active',
    team_one_name: 'FSV Mainz',
    team_two_name: 'Union Berlin',
    outcome_one_name: 'Union Berlin',
    outcome_two_name: 'Not Union Berlin',
    outcome_void_name: 'NO_CONTEST',
    market_type: 1,
    game_time_at: '2026-05-10T13:30:00.000Z',
    sport_label: 'Soccer',
    league_label: 'Bundesliga'
  };
  const result = matchMarkets([unionWin, albaBasketball], [unionSx], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.polymarketId, unionWin.conditionId);
  assert.equal(result.allCandidates.some((candidate) => candidate.polymarketId === albaBasketball.conditionId), false);
}

{
  const yunnanSpread: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-yunnan-minus-1pt5',
    question: 'Spread: Yunnan Yukun FC (-1.5)',
    marketSlug: 'csl-lia-yun-2026-05-10-spread-yun-minus-1pt5',
    description: 'Liaoning Tieren FC vs Yunnan Yukun FC',
    tags: 'Sports,Soccer,Games,China Super League',
    gameStartTime: '2026-05-10T11:00:00.000Z'
  };
  const correctLine: SxMarket = {
    market_hash: 'sx-yunnan-minus-1pt5',
    status: 'active',
    team_one_name: 'Liaoning Tieren FC',
    team_two_name: 'Yunnan Yukun',
    outcome_one_name: 'Liaoning Tieren FC +1.5',
    outcome_two_name: 'Yunnan Yukun -1.5',
    outcome_void_name: 'NO_GAME_OR_EVEN',
    market_type: 3,
    line: 1.5,
    game_time_at: '2026-05-10T11:00:00.000Z',
    sport_label: 'Soccer',
    league_label: 'China Super League'
  };
  const wrongSide: SxMarket = {
    ...correctLine,
    market_hash: 'sx-liaoning-minus-1pt5',
    outcome_one_name: 'Liaoning Tieren FC -1.5',
    outcome_two_name: 'Yunnan Yukun +1.5',
    line: -1.5
  };
  const wrongLine: SxMarket = {
    ...correctLine,
    market_hash: 'sx-yunnan-minus-0pt5',
    outcome_one_name: 'Liaoning Tieren FC +0.5',
    outcome_two_name: 'Yunnan Yukun -0.5',
    line: 0.5
  };
  const result = matchMarkets([yunnanSpread], [wrongSide, wrongLine, correctLine], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, correctLine.market_hash);
  assert.equal(result.matches[0]?.reasons.polymarketSide, 'away');
  assert.equal(result.allCandidates.some((candidate) => candidate.sxMarketHash === wrongSide.market_hash), false);
  assert.equal(result.allCandidates.some((candidate) => candidate.sxMarketHash === wrongLine.market_hash), false);
}

{
  const sportingSpread: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-sporting-minus-1pt5',
    question: 'Spread: Sporting CP (-1.5)',
    marketSlug: 'por-rio-spo-2026-05-10-spread-spo-minus-1pt5',
    description: 'Rio Ave vs Sporting CP',
    tags: 'Sports,Soccer,Games,Portugal Primeira Liga',
    gameStartTime: '2026-05-10T19:00:00.000Z'
  };
  const sx: SxMarket = {
    market_hash: 'sx-sporting-minus-1pt5',
    status: 'active',
    team_one_name: 'Rio Ave',
    team_two_name: 'Sporting Clube De Portugal CP',
    outcome_one_name: 'Rio Ave +1.5',
    outcome_two_name: 'Sporting Clube De Portugal CP -1.5',
    outcome_void_name: 'NO_GAME_OR_EVEN',
    market_type: 3,
    line: 1.5,
    game_time_at: '2026-05-10T19:00:00.000Z',
    sport_label: 'Soccer',
    league_label: 'Portugal Primeira Liga'
  };
  const result = matchMarkets([sportingSpread], [sx], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, sx.market_hash);
  assert.equal(result.matches[0]?.reasons.polymarketSide, 'away');
  assert.equal(result.matches[0]?.componentScores.line, 1);
}

{
  const tromsoSpread: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-tromso-minus-1pt5',
    question: 'Spread: Tromsø IL (-1.5)',
    marketSlug: 'eli-tro-mol-2026-05-10-spread-tro-minus-1pt5',
    description: 'Tromsø IL vs Molde',
    tags: 'Sports,Soccer,Games,Eliteserien',
    gameStartTime: '2026-05-10T16:00:00.000Z'
  };
  const sx: SxMarket = {
    market_hash: 'sx-tromso-minus-1pt5',
    status: 'active',
    team_one_name: 'Tromso',
    team_two_name: 'Molde',
    outcome_one_name: 'Tromso -1.5',
    outcome_two_name: 'Molde +1.5',
    outcome_void_name: 'NO_GAME_OR_EVEN',
    market_type: 3,
    line: -1.5,
    game_time_at: '2026-05-10T16:00:00.000Z',
    sport_label: 'Soccer',
    league_label: 'Eliteserien'
  };
  const result = matchMarkets([tromsoSpread], [sx], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, sx.market_hash);
  assert.equal(result.matches[0]?.reasons.polymarketSide, 'home');
  assert.equal(result.matches[0]?.componentScores.event, 1);
}

{
  const liaoningMoneyline: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-liaoning-moneyline',
    question: 'Will Liaoning Tieren FC win on 2026-05-10?',
    marketSlug: 'chn-lia-tie-yun-2026-05-10-liaoning-moneyline',
    description: 'Liaoning Tieren FC vs Yunnan Yukun',
    tags: 'Sports,Soccer,Games,China Super League',
    gameStartTime: '2026-05-10T11:00:00.000Z'
  };
  const sxDraw: SxMarket = {
    market_hash: 'sx-liaoning-yunnan-draw',
    status: 'active',
    team_one_name: 'Liaoning Tieren FC',
    team_two_name: 'Yunnan Yukun',
    outcome_one_name: 'Tie',
    outcome_two_name: 'Not tie',
    outcome_void_name: 'NO_CONTEST',
    market_type: 1,
    game_time_at: '2026-05-10T11:00:00.000Z',
    sport_label: 'Soccer',
    league_label: 'China Super League'
  };
  const sxMoneyline: SxMarket = {
    ...sxDraw,
    market_hash: 'sx-liaoning-yunnan-moneyline',
    outcome_one_name: 'Liaoning Tieren FC',
    outcome_two_name: 'Not Liaoning Tieren FC',
    market_type: 1
  };
  const result = matchMarkets([liaoningMoneyline], [sxDraw, sxMoneyline], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, sxMoneyline.market_hash);
  assert.equal(result.matches[0]?.reasons.polymarketSide, 'home');
  assert.equal(
    result.allCandidates.some((candidate) => candidate.sxMarketHash === sxDraw.market_hash),
    false
  );
}

{
  const priorGameTotal: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-mlb-prior-game-total',
    question: 'Athletics vs. Philadelphia Phillies: O/U 7.5',
    marketSlug: 'mlb-oak-phi-2026-05-06-total-7pt5',
    description: 'Athletics vs Philadelphia Phillies',
    tags: 'Sports,Baseball,MLB',
    gameStartTime: '2026-05-06T22:40:00.000Z'
  };
  const nextGameTotal: SxMarket = {
    market_hash: 'sx-mlb-next-game-total',
    status: 'active',
    team_one_name: 'Philadelphia Phillies',
    team_two_name: 'Athletics',
    outcome_one_name: 'Over 7.5',
    outcome_two_name: 'Under 7.5',
    outcome_void_name: 'NO_GAME_OR_EVEN',
    market_type: 28,
    line: 7.5,
    game_time_at: '2026-05-07T22:40:00.000Z',
    sport_label: 'Baseball',
    league_label: 'MLB'
  };
  const result = matchMarkets([priorGameTotal], [nextGameTotal], {
    minScore: 0.78,
    reviewScore: 0.66,
    maxTimeDeltaHours: 36
  });

  assert.equal(result.matches.length, 0);
  assert.equal(result.stats.candidateCount, 0);
}

{
  const cruzeiroWin: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-cruzeiro-win',
    question: 'Will Cruzeiro EC win on 2026-05-09?',
    marketSlug: 'bra-bah-cru-2026-05-09-cruzeiro-win',
    description: 'EC Bahia vs Cruzeiro EC',
    tags: 'Sports,Soccer,Games,Campeonato Brasileiro',
    gameStartTime: '2026-05-10T00:00:00.000Z'
  };
  const twoWay: SxMarket = {
    market_hash: 'sx-bahia-cruzeiro-two-way',
    status: 'active',
    team_one_name: 'EC Bahia',
    team_two_name: 'Cruzeiro Esporte Clube',
    outcome_one_name: 'EC Bahia',
    outcome_two_name: 'Cruzeiro Esporte Clube',
    outcome_void_name: 'NO_CONTEST',
    market_type: 52,
    game_time_at: '2026-05-10T00:00:00.000Z',
    sport_label: 'Soccer',
    league_label: 'Campeonato Brasileiro'
  };
  const teamNotTeam: SxMarket = {
    ...twoWay,
    market_hash: 'sx-cruzeiro-not-cruzeiro',
    outcome_one_name: 'Cruzeiro Esporte Clube',
    outcome_two_name: 'Not Cruzeiro Esporte Clube',
    market_type: 1
  };
  const result = matchMarkets([cruzeiroWin], [twoWay, teamNotTeam], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, teamNotTeam.market_hash);
  assert.equal(result.matches[0]?.reasons.polymarketSide, 'away');
  assert.equal(result.allCandidates.some((candidate) => candidate.sxMarketHash === twoWay.market_hash), false);
}

{
  const soccerDraw: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-soccer-draw',
    question: 'Will CS Independiente Rivadavia vs. CA Union end in a draw?',
    marketSlug: 'arg-ind-uni-2026-05-09-draw',
    description: 'CS Independiente Rivadavia vs CA Union',
    tags: 'Sports,Soccer,Games,Argentina Primera Division',
    gameStartTime: '2026-05-09T22:30:00.000Z'
  };
  const twoWay: SxMarket = {
    market_hash: 'sx-independiente-union-two-way',
    status: 'active',
    team_one_name: 'CS Independiente Rivadavia',
    team_two_name: 'CA Union',
    outcome_one_name: 'CS Independiente Rivadavia',
    outcome_two_name: 'CA Union',
    outcome_void_name: 'NO_CONTEST',
    market_type: 52,
    game_time_at: '2026-05-09T22:30:00.000Z',
    sport_label: 'Soccer',
    league_label: 'Argentina Primera Division'
  };
  const drawMarket: SxMarket = {
    ...twoWay,
    market_hash: 'sx-independiente-union-draw',
    outcome_one_name: 'Tie',
    outcome_two_name: 'Not tie',
    market_type: 1
  };
  const result = matchMarkets([soccerDraw], [twoWay, drawMarket], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.sxMarketHash, drawMarket.market_hash);
  assert.equal(result.matches[0]?.reasons.polymarketSide, 'draw');
  assert.equal(result.allCandidates.some((candidate) => candidate.sxMarketHash === twoWay.market_hash), false);
}

{
  const cricketDayProp: PolymarketMarket = {
    ...basePm,
    conditionId: 'pm-cricket-day-prop',
    question: 'Test Series Bangladesh vs. Pakistan: Bangladesh vs Pakistan - Match goes to Day 4?',
    marketSlug: 'cricket-bangladesh-pakistan-match-goes-to-day-4',
    description: 'Bangladesh vs Pakistan',
    tags: 'Sports,Cricket,International Test',
    gameStartTime: '2026-05-10T08:00:00.000Z'
  };
  const sx: SxMarket = {
    market_hash: 'sx-bangladesh-pakistan-moneyline',
    status: 'active',
    team_one_name: 'Bangladesh',
    team_two_name: 'Pakistan',
    outcome_one_name: 'Bangladesh',
    outcome_two_name: 'Pakistan',
    outcome_void_name: 'NO_CONTEST',
    market_type: 52,
    game_time_at: '2026-05-10T08:00:00.000Z',
    sport_label: 'Cricket',
    league_label: 'International Test'
  };
  const result = matchMarkets([cricketDayProp], [sx], {
    minScore: 0.78,
    reviewScore: 0.66
  });

  assert.equal(result.matches.length, 0);
  assert.equal(result.stats.candidateCount, 0);
}

console.log('Unit checks passed.');
