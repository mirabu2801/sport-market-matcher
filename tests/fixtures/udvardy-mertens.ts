import type { PolymarketMarket, SxMarket } from '../../src/types';

export const udvardyMertensPolymarket: PolymarketMarket = {
  conditionId: '0x055bddea356444684bfb8d34e9ba41c59baee260e1146ff197bf1c30e330f558',
  questionId: '0xcae71b08c835a99aae93d9c68fb0189b18fc9ff6ab6f1c8f8fb57d81181751a5',
  marketSlug: 'wta-udvardy-mertens-2026-05-07',
  question: "Internazionali BNL d'Italia: Panna Udvardy vs Elise Mertens",
  description:
    "This market refers to the tennis match between Panna Udvardy and Elise Mertens in the Internazionali BNL d'Italia, originally scheduled for May 7, 2026 at 5:00AM ET.\n\nThis market will resolve to 'Panna Udvardy' if Panna Udvardy advances against Elise Mertens.\n\nThis market will resolve to 'Elise Mertens' if Elise Mertens advances against Panna Udvardy.\n\nIf the match is canceled (not played at all), ends in a tie, or is delayed beyond 7 days from the scheduled date without a winner determined, this market will resolve to 50-50.\n\nIf the match begins but is not completed, and one player advances due to the opponent's retirement, default, or disqualification, this market will resolve to the player who advances.\n\nIf the match ends in a walkover (player withdraws before the start and the other advances automatically), this market will resolve to 50-50.\n\nThe primary resolution source will be official information from the WTA Tour. A consensus of credible reporting may also be used.",
  active: true,
  closed: false,
  archived: false,
  acceptingOrders: true,
  endDateIso: '2026-05-14T00:00:00Z',
  gameStartTime: '2026-05-07T09:00:00Z',
  isSport: true,
  isCrypto: false,
  tags: 'Sports,Tennis,Games',
  tokens:
    '[{"token_id":"45572838953758994816038479695980826899969889984822306270204970258380018598420","outcome":"Panna Udvardy","price":0.215,"winner":false},{"token_id":"37927338089317982777626277783412408931689590258830098091007172273228925714890","outcome":"Elise Mertens","price":0.785,"winner":false}]'
};

export const udvardyMertensSx: SxMarket = {
  market_hash: '0xfb247e0b53e55c9519ac1f190e58718dad4729338c0e16f319bf01c2ba813b83',
  status: 'ACTIVE',
  outcome_one_name: 'Panna Udvardy',
  outcome_two_name: 'Elise Mertens',
  outcome_void_name: 'NO_CONTEST',
  team_one_name: 'Panna Udvardy',
  team_two_name: 'Elise Mertens',
  market_type: 52,
  game_time: 1778144400,
  game_time_at: '2026-05-07T09:00:00.000Z',
  line: null,
  sport_x_event_id: 'L18819687',
  live_enabled: true,
  sport_label: 'Tennis',
  sport_id: 6,
  league_id: 1246,
  league_label: 'WTA Rome',
  group1: 'WTA Rome',
  group2: null,
  participant_one_id: 358368,
  participant_two_id: 339321,
  main_line: null,
  raw: {
    type: 52,
    __type: 'Market',
    group1: 'WTA Rome',
    status: 'ACTIVE',
    sportId: 6,
    gameTime: 1778144400,
    leagueId: 1246,
    marketHash: '0xfb247e0b53e55c9519ac1f190e58718dad4729338c0e16f319bf01c2ba813b83',
    sportLabel: 'Tennis',
    leagueLabel: 'WTA Rome',
    liveEnabled: true,
    teamOneName: 'Panna Udvardy',
    teamTwoName: 'Elise Mertens',
    chainVersion: 'SXR',
    sportXeventId: 'L18819687',
    outcomeOneName: 'Panna Udvardy',
    outcomeTwoName: 'Elise Mertens',
    outcomeVoidName: 'NO_CONTEST',
    participantOneId: 358368,
    participantTwoId: 339321
  }
};

export const udvardyMertensSetHandicapPolymarket: PolymarketMarket = {
  conditionId: '0x77fba3c1e43fc92cd4527983e1fe44c019f4408bfa80b7929d395c43eaad5631',
  questionId: '0x40d0858d006bbc5ecd2544a31c23a0c236f75e821ad7051bcd81efa3cdacd95c',
  marketSlug: 'wta-udvardy-mertens-2026-05-07-set-handicap-away-1pt5',
  question: 'Set Handicap: Mertens (-1.5) vs Udvardy (+1.5)',
  description: `This market refers to the tennis match between Elise Mertens and Panna Udvardy in the Internazionali BNL d'Italia, originally scheduled for May 7, 2026 at 5:00AM ET.
This market will resolve to "Mertens" if Elise Mertens wins by 2 or more sets than Panna Udvardy, based on the final completed score. Otherwise, it will resolve to "Udvardy."
If the match begins but is not completed, this market will resolve 50-50. If the match is canceled before play begins or delayed beyond 7 days from the scheduled date without a result, this market will also resolve 50-50.
Resolution will be based on official WTA results.`,
  active: true,
  closed: false,
  archived: false,
  acceptingOrders: true,
  endDateIso: '2026-05-14T00:00:00Z',
  gameStartTime: '2026-05-07T09:00:00Z',
  isSport: true,
  isCrypto: false,
  tags: 'Sports,Tennis,Games',
  tokens:
    '[{"token_id":"35943754795381080561096964494786649146907295456575323855010940731298595395096","outcome":"Mertens","price":0.555,"winner":false},{"token_id":"64348816669499485020568527092747098958250380509223044758820206308192149253982","outcome":"Udvardy","price":0.445,"winner":false}]'
};

export const udvardyMertensSetHandicapSx: SxMarket = {
  market_hash: '0x87509c0ba9ba79821c0177cb9e719709c688a3084993bf75bb9fcbcbfa696f7a',
  status: 'ACTIVE',
  outcome_one_name: 'Panna Udvardy +1.5 (sets)',
  outcome_two_name: 'Elise Mertens -1.5 (sets)',
  outcome_void_name: 'NO_GAME_OR_EVEN',
  team_one_name: 'Panna Udvardy',
  team_two_name: 'Elise Mertens',
  market_type: 866,
  game_time: 1778144400,
  game_time_at: '2026-05-07T09:00:00.000Z',
  line: '1.5',
  sport_x_event_id: 'L18819687',
  live_enabled: true,
  sport_label: 'Tennis',
  sport_id: 6,
  league_id: 1246,
  league_label: 'WTA Rome',
  group1: 'WTA Rome',
  group2: null,
  participant_one_id: 358368,
  participant_two_id: 339321,
  main_line: true,
  raw: {
    line: 1.5,
    type: 866,
    __type: 'Market',
    group1: 'WTA Rome',
    status: 'ACTIVE',
    sportId: 6,
    gameTime: 1778144400,
    leagueId: 1246,
    mainLine: true,
    marketHash: '0x87509c0ba9ba79821c0177cb9e719709c688a3084993bf75bb9fcbcbfa696f7a',
    sportLabel: 'Tennis',
    leagueLabel: 'WTA Rome',
    liveEnabled: true,
    teamOneName: 'Panna Udvardy',
    teamTwoName: 'Elise Mertens',
    chainVersion: 'SXR',
    sportXeventId: 'L18819687',
    outcomeOneName: 'Panna Udvardy +1.5 (sets)',
    outcomeTwoName: 'Elise Mertens -1.5 (sets)',
    outcomeVoidName: 'NO_GAME_OR_EVEN',
    participantOneId: 358368,
    participantTwoId: 339321
  }
};
