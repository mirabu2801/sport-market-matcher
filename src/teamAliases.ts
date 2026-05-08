import { normalizeText } from './normalization';

const TEAM_ALIASES: Record<string, string> = {};

addAliases('Atlanta Hawks', ['hawks']);
addAliases('Boston Celtics', ['celtics']);
addAliases('Brooklyn Nets', ['nets']);
addAliases('Charlotte Hornets', ['hornets']);
addAliases('Chicago Bulls', ['bulls']);
addAliases('Cleveland Cavaliers', ['cavaliers', 'cavs']);
addAliases('Dallas Mavericks', ['mavericks', 'mavs']);
addAliases('Denver Nuggets', ['nuggets']);
addAliases('Detroit Pistons', ['pistons']);
addAliases('Golden State Warriors', ['warriors', 'gsw']);
addAliases('Houston Rockets', ['rockets']);
addAliases('Indiana Pacers', ['pacers']);
addAliases('Los Angeles Clippers', ['clippers', 'la clippers']);
addAliases('Los Angeles Lakers', ['lakers', 'la lakers', 'l.a. lakers']);
addAliases('Memphis Grizzlies', ['grizzlies']);
addAliases('Miami Heat', ['heat']);
addAliases('Milwaukee Bucks', ['bucks']);
addAliases('Minnesota Timberwolves', ['timberwolves', 'wolves']);
addAliases('New Orleans Pelicans', ['pelicans', 'pels']);
addAliases('New York Knicks', ['knicks']);
addAliases('Oklahoma City Thunder', ['thunder', 'okc']);
addAliases('Orlando Magic', ['magic']);
addAliases('Philadelphia 76ers', ['76ers', 'sixers']);
addAliases('Phoenix Suns', ['suns']);
addAliases('Portland Trail Blazers', ['trail blazers', 'blazers']);
addAliases('Sacramento Kings', ['kings']);
addAliases('San Antonio Spurs', ['spurs']);
addAliases('Toronto Raptors', ['raptors']);
addAliases('Utah Jazz', ['jazz']);
addAliases('Washington Wizards', ['wizards']);

addAliases('Anaheim Ducks', ['ducks']);
addAliases('Boston Bruins', ['bruins']);
addAliases('Buffalo Sabres', ['sabres']);
addAliases('Calgary Flames', ['flames']);
addAliases('Carolina Hurricanes', ['hurricanes', 'canes']);
addAliases('Chicago Blackhawks', ['blackhawks']);
addAliases('Colorado Avalanche', ['avalanche', 'avs']);
addAliases('Columbus Blue Jackets', ['blue jackets']);
addAliases('Dallas Stars', ['stars']);
addAliases('Detroit Red Wings', ['red wings']);
addAliases('Edmonton Oilers', ['oilers']);
addAliases('Florida Panthers', ['panthers']);
addAliases('Los Angeles Kings', ['la kings']);
addAliases('Minnesota Wild', ['wild']);
addAliases('Montreal Canadiens', ['canadiens', 'habs']);
addAliases('Nashville Predators', ['predators', 'preds']);
addAliases('New Jersey Devils', ['devils']);
addAliases('New York Islanders', ['islanders']);
addAliases('New York Rangers', ['rangers']);
addAliases('Ottawa Senators', ['senators', 'sens']);
addAliases('Philadelphia Flyers', ['flyers']);
addAliases('Pittsburgh Penguins', ['penguins', 'pens']);
addAliases('San Jose Sharks', ['sharks']);
addAliases('Seattle Kraken', ['kraken']);
addAliases('St. Louis Blues', ['st louis blues', 'blues']);
addAliases('Tampa Bay Lightning', ['lightning', 'bolts']);
addAliases('Toronto Maple Leafs', ['maple leafs', 'leafs']);
addAliases('Utah Hockey Club', ['utah', 'mammoth', 'utah mammoth']);
addAliases('Vancouver Canucks', ['canucks']);
addAliases('Vegas Golden Knights', ['golden knights', 'vgk']);
addAliases('Washington Capitals', ['capitals', 'caps']);
addAliases('Winnipeg Jets', ['jets']);

addAliases('Arizona Diamondbacks', ['diamondbacks', 'dbacks']);
addAliases('Atlanta Braves', ['braves']);
addAliases('Baltimore Orioles', ['orioles', 'os']);
addAliases('Boston Red Sox', ['red sox']);
addAliases('Chicago Cubs', ['cubs']);
addAliases('Chicago White Sox', ['white sox']);
addAliases('Cincinnati Reds', ['reds']);
addAliases('Cleveland Guardians', ['guardians']);
addAliases('Colorado Rockies', ['rockies']);
addAliases('Detroit Tigers', ['tigers']);
addAliases('Houston Astros', ['astros']);
addAliases('Kansas City Royals', ['royals']);
addAliases('Los Angeles Angels', ['angels']);
addAliases('Los Angeles Dodgers', ['dodgers']);
addAliases('Miami Marlins', ['marlins']);
addAliases('Milwaukee Brewers', ['brewers']);
addAliases('Minnesota Twins', ['twins']);
addAliases('New York Mets', ['mets']);
addAliases('New York Yankees', ['yankees']);
addAliases('Oakland Athletics', ['athletics', 'as']);
addAliases('Philadelphia Phillies', ['phillies']);
addAliases('Pittsburgh Pirates', ['pirates']);
addAliases('San Diego Padres', ['padres']);
addAliases('San Francisco Giants', ['giants']);
addAliases('Seattle Mariners', ['mariners']);
addAliases('St. Louis Cardinals', ['st louis cardinals', 'cardinals']);
addAliases('Tampa Bay Rays', ['rays']);
addAliases('Texas Rangers', ['texas rangers']);
addAliases('Toronto Blue Jays', ['blue jays', 'jays']);
addAliases('Washington Nationals', ['nationals', 'nats']);

addAliases('Manchester City', ['man city']);
addAliases('Manchester United', ['man united', 'man utd']);
addAliases('Tottenham', ['tottenham hotspur']);
addAliases('Newcastle', ['newcastle united']);
addAliases('West Ham', ['west ham united']);
addAliases('Wolverhampton', ['wolves', 'wolverhampton wanderers']);
addAliases('PSG', ['paris saint germain', 'paris saint-germain']);
addAliases('Inter Milan', ['inter', 'internazionale', 'internazionale milano', 'fc internazionale milano']);
addAliases('Bayern Munich', ['bayern munchen', 'bayern münchen']);
addAliases('Atletico Madrid', ['atletico']);
addAliases('Real Madrid', ['real madrid cf']);
addAliases('Sporting CP', ['sporting clube de portugal cp', 'sporting clube de portugal', 'sporting lisbon']);
addAliases('Cruzeiro Esporte Clube', ['cruzeiro ec', 'cruzeiro']);
addAliases('UCV FC', ['universidad central de venezuela', 'universidad central de venezuela fc', 'ucv']);
addAliases('Rennes', ['stade rennais', 'stade rennais fc', 'stade rennais fc 1901']);
addAliases('HamKam', ['hamarkameratene']);
addAliases('Lyon', ['olympique lyonnais']);

addAliases('G2 Esports', ['g2']);
addAliases('Karmine Corp', ['karmine corp gc', 'kc']);
addAliases('Movistar KOI', ['movistar koi', 'mkoi']);

const PREFIX_RE = /^(club|fc|cf|sc|afc|ac|as|ca|cd|cs|csd|ec|fk|nk|rb|sl|sk)\s+/i;
const SUFFIX_RE = /\s+(fc|cf|sc|afc|ac|bc|bk|club|team|women|men|w|gc|esport|esports|gaming)$/i;
const PARENS_RE = /\s*\([^)]*\)\s*$/;

export function canonicalTeamName(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) {
    return '';
  }

  const normalized = normalizeText(text);
  const direct = TEAM_ALIASES[normalized];
  if (direct) {
    return direct;
  }

  const stripped = stripTeamAffixes(text);
  const strippedNormalized = normalizeText(stripped);
  return TEAM_ALIASES[strippedNormalized] ?? stripped;
}

export function teamSearchNames(raw: unknown, canonical: string = canonicalTeamName(raw)): string[] {
  const names = new Set<string>();
  addSearchName(names, raw);
  addSearchName(names, canonical);

  const normalizedCanonical = normalizeText(canonical);
  const canonicalAliases = Object.entries(TEAM_ALIASES)
    .filter(([, value]) => normalizeText(value) === normalizedCanonical)
    .map(([alias]) => alias);

  for (const alias of canonicalAliases) {
    addSearchName(names, alias);
  }

  const tokens = normalizeText(canonical).split(' ').filter(Boolean);
  const lastToken = tokens.at(-1);
  if (
    lastToken &&
    lastToken.length > 2 &&
    ![
      'city',
      'club',
      'team',
      'united',
      'sport',
      'sports',
      'women',
      'men',
      'w',
      'esport',
      'esports',
      'gaming',
      'gc'
    ].includes(lastToken)
  ) {
    addSearchName(names, lastToken);
  }

  return [...names].filter(Boolean);
}

export function canonicalTeamPairKey(teamOne: string, teamTwo: string): string {
  return [normalizeText(teamOne), normalizeText(teamTwo)].sort().join('|');
}

function stripTeamAffixes(raw: string): string {
  return raw.trim().replace(PARENS_RE, '').replace(PREFIX_RE, '').replace(SUFFIX_RE, '').trim();
}

function addAliases(canonical: string, aliases: string[]): void {
  TEAM_ALIASES[normalizeText(canonical)] = canonical;
  for (const alias of aliases) {
    TEAM_ALIASES[normalizeText(alias)] = canonical;
  }
}

function addSearchName(names: Set<string>, value: unknown): void {
  const normalized = normalizeText(value);
  if (normalized) {
    names.add(normalized);
  }
}
