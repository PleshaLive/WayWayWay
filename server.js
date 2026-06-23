const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const xlsx = require('xlsx');
const stats = require('./stats');
const graphicsUtils = require('./lib/graphics-utils');
const matchFinalization = require('./lib/match-finalization');

const app = express();
const port = process.env.PORT || 2727;

// Middleware -ï¿½-+-ï¿½ -+-ï¿½-ï¿½-ï¿½-+-+-ï¿½-ï¿½ JSON -+ URL-encoded -ï¿½-ï¿½-+-+-ï¿½-ï¿½
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// -ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½-ï¿½ CORS -ï¿½-+-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½
app.use(cors()); // <--- -ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½, -ï¿½-ï¿½-+ -ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½

// -ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½ (-+-+-ï¿½-+-ï¿½-+-+-ï¿½, -ï¿½-+-ï¿½-+ -+ -ï¿½.-ï¿½.)
app.use(express.static(path.join(__dirname, 'public')));

// -ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½ -ï¿½-+-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ (persistent storage)
const DATA_FILE = path.join(__dirname, 'data.json');
const STORAGE_DIR = path.join(__dirname, 'storage');
const STORAGE_FILES = {
  postmatch: path.join(STORAGE_DIR, 'postmatch.json'),
  completedMatches: path.join(STORAGE_DIR, 'completedMatches.json'),
  liveMatch: path.join(STORAGE_DIR, 'liveMatch.json'),
  teamStats: path.join(STORAGE_DIR, 'teamStats.json'),
  playerStats: path.join(STORAGE_DIR, 'playerStats.json'),
  mapStats: path.join(STORAGE_DIR, 'mapStats.json'),
  headToHead: path.join(STORAGE_DIR, 'headToHead.json')
};

const DEFAULT_PLAYER_STATS = {
  kills: 0,
  deaths: 0,
  assists: 0,
  damage: 0,
  roundsPlayed: 0,
  headshots: null,
  headshotRate: null,
  multiKills: {
    oneKillRounds: 0,
    twoKillRounds: 0,
    threeKillRounds: 0,
    fourKillRounds: 0,
    fiveKillRounds: 0,
    aces: 0,
    totalMultiKillRounds: 0
  },
  opening: {
    firstKills: null,
    firstDeaths: null,
    entryDiff: null
  },
  clutches: {
    attempts: null,
    wins: null,
    oneVsOne: null,
    oneVsTwo: null,
    oneVsThree: null,
    oneVsFour: null,
    oneVsFive: null
  },
  utility: {
    flashesThrown: null,
    enemiesFlashed: null,
    flashAssists: null,
    smokesThrown: null,
    heThrown: null,
    molotovsThrown: null,
    decoysThrown: null,
    utilityDamage: null
  },
  economy: {
    money: null,
    equipmentValue: null,
    spendThisRound: null
  },
  weaponStats: {},
  sideStats: {
    CT: { rounds: 0, kills: 0, deaths: 0, adr: 0 },
    T: { rounds: 0, kills: 0, deaths: 0, adr: 0 }
  },
  rating: 0,
  customRating: 0
};

const EMPTY_TOP_PLAYERS = {
  kills: [],
  adr: [],
  damage: [],
  kd: [],
  plusMinus: [],
  rating: [],
  aces: [],
  multiKills: [],
  flashAssists: [],
  enemiesFlashed: []
};

function cloneEmptyTopPlayers() {
  return {
    kills: [],
    adr: [],
    damage: [],
    kd: [],
    plusMinus: [],
    rating: [],
    aces: [],
    multiKills: [],
    flashAssists: [],
    enemiesFlashed: []
  };
}

function createPlaceholderPlayer() {
  return {
    id: null,
    steamId: '',
    nickname: '',
    name: '',
    photo: '',
    teamId: null,
    teamName: '',
    teamLogo: '',
    side: '',
    kills: 0,
    deaths: 0,
    assists: 0,
    plusMinus: 0,
    kd: 0,
    dpr: 0,
    kda: 0,
    damage: 0,
    damageTotal: 0,
    damageCurrentRound: null,
    damagePreviousRound: null,
    damageByRound: [],
    adr: 0,
    kpr: 0,
    apr: 0,
    damagePerKill: 0,
    roundsPlayed: 0,
    survivedRounds: 0,
    survivalRate: 0,
    survivedRoundsCount: 0,
    survivalPercentage: 0,
    kast: null,
    kastPercentage: null,
    impact: null,
    scoreboardRank: null,
    multiKills: {
      oneKillRounds: 0,
      twoKillRounds: 0,
      threeKillRounds: 0,
      fourKillRounds: 0,
      fiveKillRounds: 0,
      twoKCount: 0,
      threeKCount: 0,
      fourKCount: 0,
      fiveKCount: 0,
      aces: 0,
      totalMultiKillRounds: 0
    },
    multiKills_1k: 0,
    multiKills_2k: 0,
    multiKills_3k: 0,
    multiKills_4k: 0,
    multiKills_5k: 0,
    multiKills_aces: 0,
    multiKills_total: 0,
    headshots: {
      count: null,
      rate: null,
      percentage: null,
      available: false
    },
    headshots_count: null,
    headshots_rate: null,
    headshots_percentage: null,
    hsCount: null,
    hsPercentage: null,
    opening: {
      firstKills: null,
      firstDeaths: null,
      openingKpr: null,
      entryDiff: null,
      available: false
    },
    opening_firstKills: null,
    opening_firstDeaths: null,
    opening_kpr: null,
    opening_entryDiff: null,
    openingKpr: null,
    weapons: {
      awpKills: null,
      awpKpr: null,
      rifleKills: null,
      knifeKills: null,
      zeusKills: null,
      pistolKills: null,
      smgKills: null,
      available: false
    },
    awpKills: null,
    awpKpr: null,
    weapons_awpKills: null,
    weapons_awpKpr: null,
    rifleKills: null,
    weapons_rifleKills: null,
    knifeKills: null,
    weapons_knifeKills: null,
    zeusKills: null,
    weapons_zeusKills: null,
    pistolKills: null,
    weapons_pistolKills: null,
    smgKills: null,
    weapons_smgKills: null,
    weaponUnknownKills: null,
    weapons_weaponUnknownKills: null,
    clutches: {
      attempts: null,
      wins: null,
      oneVsOne: null,
      oneVsTwo: null,
      oneVsThree: null,
      oneVsFour: null,
      oneVsFive: null
    },
    clutches_attempts: null,
    clutches_wins: null,
    clutches_losses: null,
    clutches_1v1_attempts: null,
    clutches_1v1_wins: null,
    clutches_1v1_losses: null,
    clutches_1v2_attempts: null,
    clutches_1v2_wins: null,
    clutches_1v2_losses: null,
    clutches_1v3_attempts: null,
    clutches_1v3_wins: null,
    clutches_1v3_losses: null,
    clutches_1v4_attempts: null,
    clutches_1v4_wins: null,
    clutches_1v4_losses: null,
    clutches_1v5_attempts: null,
    clutches_1v5_wins: null,
    clutches_1v5_losses: null,
    clutches_oneVsOne: null,
    clutches_oneVsTwo: null,
    clutches_oneVsThree: null,
    clutches_oneVsFour: null,
    clutches_oneVsFive: null,
    clutchWinRate: null,
    utility: {
      flashesThrown: null,
      enemiesFlashed: null,
      flashAssists: null,
      smokesThrown: null,
      heThrown: null,
      molotovsThrown: null,
      decoysThrown: null,
      utilityDamage: null,
      available: false
    },
    utility_flashAssists: null,
    utility_flashesThrown: null,
    utility_enemiesFlashed: null,
    utility_smokesThrown: null,
    utility_heThrown: null,
    utility_molotovsThrown: null,
    utility_utilityDamage: null,
    flashAssists: null,
    flashesThrown: null,
    enemiesFlashed: null,
    smokesThrown: null,
    heThrown: null,
    molotovsThrown: null,
    utilityDamage: null,
    economy: {
      money: null,
      equipmentValue: null,
      spendThisRound: null
    },
    roundStats: {
      killsByRound: [],
      damageByRound: [],
      survivedByRound: [],
      kastByRound: []
    },
    availability: {
      basic: true,
      damage: true,
      multiKills: true,
      headshots: false,
      opening: false,
      weapons: false,
      utility: false,
      clutches: false,
      kast: false,
      impact: false
    },
    weaponStats: {},
    sideStats: {
      CT: { rounds: 0, kills: 0, deaths: 0, adr: 0 },
      T: { rounds: 0, kills: 0, deaths: 0, adr: 0 }
    },
    rating: 0,
    customRating: 0,
    isPlaceholder: true
  };
}

function createPlaceholderPlayers(count) {
  return Array.from({ length: count }, () => createPlaceholderPlayer());
}

function normalizePlayerStatsShape(player, { placeholder = false } = {}) {
  const source = player || {};
  const base = createPlaceholderPlayer();
  const result = {
    ...base,
    ...source,
    multiKills: {
      ...base.multiKills,
      ...(source.multiKills || {})
    },
    headshots: {
      ...base.headshots,
      ...(source.headshots || {})
    },
    opening: {
      ...base.opening,
      ...(source.opening || {})
    },
    weapons: {
      ...base.weapons,
      ...(source.weapons || {})
    },
    clutches: {
      ...base.clutches,
      ...(source.clutches || {})
    },
    utility: {
      ...base.utility,
      ...(source.utility || {})
    },
    economy: {
      ...base.economy,
      ...(source.economy || {})
    },
    roundStats: {
      ...base.roundStats,
      ...(source.roundStats || {})
    },
    availability: {
      ...base.availability,
      ...(source.availability || {})
    },
    sideStats: {
      CT: {
        ...base.sideStats.CT,
        ...(source.sideStats?.CT || {})
      },
      T: {
        ...base.sideStats.T,
        ...(source.sideStats?.T || {})
      }
    },
    weaponStats: source.weaponStats || {},
    isPlaceholder: placeholder || !!source.isPlaceholder
  };

  result.id = source.id ?? null;
  result.steamId = source.steamId != null ? String(source.steamId) : '';
  result.nickname = source.nickname != null ? String(source.nickname) : '';
  result.name = source.name != null ? String(source.name) : '';
  result.photo = source.photo != null ? String(source.photo) : '';
  result.teamId = source.teamId ?? null;
  result.teamName = source.teamName != null ? String(source.teamName) : '';
  result.teamLogo = source.teamLogo != null ? String(source.teamLogo) : '';
  result.side = source.side != null ? String(source.side) : '';
  result.kills = toNumber(source.kills, 0);
  result.deaths = toNumber(source.deaths, 0);
  result.assists = toNumber(source.assists, 0);
  result.kd = toNumber(source.kd, 0);
  result.dpr = toNumber(source.dpr, 0);
  result.kda = toNumber(source.kda, 0);
  result.plusMinus = toNumber(source.plusMinus, 0);
  result.damage = toNumber(source.damage, 0);
  result.damageTotal = toNumber(source.damageTotal ?? source.damage, 0);
  result.damageCurrentRound = source.damageCurrentRound != null ? toNumber(source.damageCurrentRound, 0) : null;
  result.damagePreviousRound = source.damagePreviousRound != null ? toNumber(source.damagePreviousRound, 0) : null;
  result.damageByRound = Array.isArray(source.damageByRound)
    ? source.damageByRound.map((value) => toNumber(value, 0))
    : (Array.isArray(source.roundStats?.damageByRound) ? source.roundStats.damageByRound.map((value) => toNumber(value, 0)) : []);
  result.adr = toNumber(source.adr, 0);
  result.kpr = toNumber(source.kpr, 0);
  result.apr = toNumber(source.apr, 0);
  result.damagePerKill = toNumber(source.damagePerKill, 0);
  result.roundsPlayed = toNumber(source.roundsPlayed, 0);
  result.survivedRounds = toNumber(source.survivedRounds, 0);
  result.survivalRate = toNumber(source.survivalRate, 0);
  result.survivedRoundsCount = toNumber(source.survivedRoundsCount, result.survivedRounds);
  result.survivalPercentage = toNumber(source.survivalPercentage, result.survivalRate);
  result.kast = source.kast ?? null;
  result.kastPercentage = source.kastPercentage ?? result.kast;
  result.impact = source.impact ?? null;
  result.scoreboardRank = source.scoreboardRank != null ? toNumber(source.scoreboardRank, null) : null;
  result.multiKills_1k = toNumber(source.multiKills_1k, toNumber(source.multiKills?.oneKillRounds, 0));
  result.multiKills_2k = toNumber(source.multiKills_2k, toNumber(source.multiKills?.twoKCount ?? source.multiKills?.twoKillRounds, 0));
  result.multiKills_3k = toNumber(source.multiKills_3k, toNumber(source.multiKills?.threeKCount ?? source.multiKills?.threeKillRounds, 0));
  result.multiKills_4k = toNumber(source.multiKills_4k, toNumber(source.multiKills?.fourKCount ?? source.multiKills?.fourKillRounds, 0));
  result.multiKills_5k = toNumber(source.multiKills_5k, toNumber(source.multiKills?.fiveKCount ?? source.multiKills?.fiveKillRounds, 0));
  result.multiKills_aces = toNumber(source.multiKills_aces, toNumber(source.multiKills?.aces, 0));
  result.multiKills_total = toNumber(source.multiKills_total, toNumber(source.multiKills?.totalMultiKillRounds, 0));
  result.headshots_count = source.headshots_count ?? source.headshots?.count ?? null;
  result.headshots_rate = source.headshots_rate ?? source.headshots?.rate ?? null;
  result.headshots_percentage = source.headshots_percentage ?? source.headshots?.percentage ?? null;
  result.hsCount = source.hsCount ?? result.headshots_count;
  result.hsPercentage = source.hsPercentage ?? result.headshots_percentage;
  result.opening_firstKills = source.opening_firstKills ?? source.opening?.firstKills ?? null;
  result.opening_firstDeaths = source.opening_firstDeaths ?? source.opening?.firstDeaths ?? null;
  result.opening_kpr = source.opening_kpr ?? source.opening?.openingKpr ?? null;
  result.opening_entryDiff = source.opening_entryDiff ?? source.opening?.entryDiff ?? null;
  result.openingKpr = source.openingKpr ?? result.opening_kpr;

  result.awpKills = source.awpKills ?? source.weapons?.awpKills ?? null;
  result.awpKpr = source.awpKpr ?? source.weapons?.awpKpr ?? null;
  result.weapons_awpKills = source.weapons_awpKills ?? result.awpKills;
  result.weapons_awpKpr = source.weapons_awpKpr ?? result.awpKpr;

  result.rifleKills = source.rifleKills ?? source.weapons?.rifleKills ?? null;
  result.weapons_rifleKills = source.weapons_rifleKills ?? result.rifleKills;
  result.knifeKills = source.knifeKills ?? source.weapons?.knifeKills ?? null;
  result.weapons_knifeKills = source.weapons_knifeKills ?? result.knifeKills;
  result.zeusKills = source.zeusKills ?? source.weapons?.zeusKills ?? null;
  result.weapons_zeusKills = source.weapons_zeusKills ?? result.zeusKills;
  result.pistolKills = source.pistolKills ?? source.weapons?.pistolKills ?? null;
  result.weapons_pistolKills = source.weapons_pistolKills ?? result.pistolKills;
  result.smgKills = source.smgKills ?? source.weapons?.smgKills ?? null;
  result.weapons_smgKills = source.weapons_smgKills ?? result.smgKills;
  result.weaponUnknownKills = source.weaponUnknownKills ?? source.weapons?.unknownKills ?? null;
  result.weapons_weaponUnknownKills = source.weapons_weaponUnknownKills ?? result.weaponUnknownKills;

  result.clutches_attempts = source.clutches_attempts ?? source.clutches?.attempts ?? null;
  result.clutches_wins = source.clutches_wins ?? source.clutches?.wins ?? null;
  result.clutches_losses = source.clutches_losses
    ?? source.clutches?.losses
    ?? (result.clutches_attempts != null && result.clutches_wins != null ? (result.clutches_attempts - result.clutches_wins) : null);
  result.clutches_1v1_attempts = source.clutches_1v1_attempts ?? source.clutches?.oneVsOne ?? null;
  result.clutches_1v1_wins = source.clutches_1v1_wins ?? source.clutches?.oneVsOneWins ?? null;
  result.clutches_1v1_losses = source.clutches_1v1_losses ?? source.clutches?.oneVsOneLosses ?? null;
  result.clutches_1v2_attempts = source.clutches_1v2_attempts ?? source.clutches?.oneVsTwo ?? null;
  result.clutches_1v2_wins = source.clutches_1v2_wins ?? source.clutches?.oneVsTwoWins ?? null;
  result.clutches_1v2_losses = source.clutches_1v2_losses ?? source.clutches?.oneVsTwoLosses ?? null;
  result.clutches_1v3_attempts = source.clutches_1v3_attempts ?? source.clutches?.oneVsThree ?? null;
  result.clutches_1v3_wins = source.clutches_1v3_wins ?? source.clutches?.oneVsThreeWins ?? null;
  result.clutches_1v3_losses = source.clutches_1v3_losses ?? source.clutches?.oneVsThreeLosses ?? null;
  result.clutches_1v4_attempts = source.clutches_1v4_attempts ?? source.clutches?.oneVsFour ?? null;
  result.clutches_1v4_wins = source.clutches_1v4_wins ?? source.clutches?.oneVsFourWins ?? null;
  result.clutches_1v4_losses = source.clutches_1v4_losses ?? source.clutches?.oneVsFourLosses ?? null;
  result.clutches_1v5_attempts = source.clutches_1v5_attempts ?? source.clutches?.oneVsFive ?? null;
  result.clutches_1v5_wins = source.clutches_1v5_wins ?? source.clutches?.oneVsFiveWins ?? null;
  result.clutches_1v5_losses = source.clutches_1v5_losses ?? source.clutches?.oneVsFiveLosses ?? null;
  result.clutches_oneVsOne = source.clutches_oneVsOne ?? source.clutches?.oneVsOne ?? null;
  result.clutches_oneVsTwo = source.clutches_oneVsTwo ?? source.clutches?.oneVsTwo ?? null;
  result.clutches_oneVsThree = source.clutches_oneVsThree ?? source.clutches?.oneVsThree ?? null;
  result.clutches_oneVsFour = source.clutches_oneVsFour ?? source.clutches?.oneVsFour ?? null;
  result.clutches_oneVsFive = source.clutches_oneVsFive ?? source.clutches?.oneVsFive ?? null;
  result.clutchWinRate = source.clutchWinRate
    ?? source.clutches?.winRate
    ?? (result.clutches_attempts > 0 && result.clutches_wins != null ? parseFloat(((result.clutches_wins / result.clutches_attempts) * 100).toFixed(2)) : null);

  result.flashAssists = source.flashAssists ?? source.utility?.flashAssists ?? null;
  result.utility_flashAssists = source.utility_flashAssists ?? result.flashAssists;
  result.flashesThrown = source.flashesThrown ?? source.utility?.flashesThrown ?? null;
  result.utility_flashesThrown = source.utility_flashesThrown ?? result.flashesThrown;
  result.enemiesFlashed = source.enemiesFlashed ?? source.utility?.enemiesFlashed ?? null;
  result.utility_enemiesFlashed = source.utility_enemiesFlashed ?? result.enemiesFlashed;
  result.smokesThrown = source.smokesThrown ?? source.utility?.smokesThrown ?? null;
  result.utility_smokesThrown = source.utility_smokesThrown ?? result.smokesThrown;
  result.heThrown = source.heThrown ?? source.utility?.heThrown ?? null;
  result.utility_heThrown = source.utility_heThrown ?? result.heThrown;
  result.molotovsThrown = source.molotovsThrown ?? source.utility?.molotovsThrown ?? null;
  result.utility_molotovsThrown = source.utility_molotovsThrown ?? result.molotovsThrown;
  result.utilityDamage = source.utilityDamage ?? source.utility?.utilityDamage ?? null;
  result.utility_utilityDamage = source.utility_utilityDamage ?? result.utilityDamage;

  result.rating = toNumber(source.rating, 0);
  result.customRating = toNumber(source.customRating, 0);
  result.isPlaceholder = !!source.isPlaceholder || placeholder;

  return result;
}

function normalizeTopPlayerEntry(player) {
  if (!player) return null;
  return {
    id: player.id ?? null,
    name: player.name || player.nickname || '',
    nickname: player.nickname || player.name || '',
    photo: player.photo || '',
    teamId: player.teamId ?? null,
    teamLogo: player.teamLogo || '',
    value: toNumber(player.value, 0)
  };
}

function buildStableTopPlayers(rawTopPlayers) {
  const source = rawTopPlayers && typeof rawTopPlayers === 'object' ? rawTopPlayers : {};
  const result = cloneEmptyTopPlayers();
  for (const key of Object.keys(result)) {
    result[key] = Array.isArray(source[key]) ? source[key].map(normalizeTopPlayerEntry).filter(Boolean) : [];
  }
  return result;
}

function buildStableMvp(player) {
  if (!player) return null;
  return normalizePlayerStatsShape(player, { placeholder: false });
}

function buildStablePlayerList(playersList, totalSlots) {
  const normalized = Array.isArray(playersList)
    ? playersList.slice(0, totalSlots).map((player) => normalizePlayerStatsShape(player, { placeholder: !!player?.isPlaceholder }))
    : [];
  while (normalized.length < totalSlots) {
    normalized.push(createPlaceholderPlayer());
  }
  return normalized;
}

function buildTeamSlotList(playersList, totalSlots) {
  const slots = buildStablePlayerList(playersList, totalSlots);
  while (slots.length > totalSlots) slots.pop();
  return slots;
}

function buildCompactPlayerStatsPayload(payload) {
  return {
    mode: payload.mode,
    players: Array.isArray(payload.players) ? payload.players.map((player) => normalizePlayerStatsShape(player, { placeholder: !!player?.isPlaceholder })) : [],
    teamAPlayers: Array.isArray(payload.teamAPlayers) ? payload.teamAPlayers.map((player) => normalizePlayerStatsShape(player, { placeholder: !!player?.isPlaceholder })) : [],
    teamBPlayers: Array.isArray(payload.teamBPlayers) ? payload.teamBPlayers.map((player) => normalizePlayerStatsShape(player, { placeholder: !!player?.isPlaceholder })) : [],
    topPlayers: buildStableTopPlayers(payload.topPlayers),
    mvp: payload.mvp ? normalizePlayerStatsShape(payload.mvp, { placeholder: !!payload.mvp.isPlaceholder }) : null,
    updatedAt: payload.updatedAt || ''
  };
}

function readCompletedMatches() {
  const completed = readJsonSafe(STORAGE_FILES.completedMatches, []);
  return Array.isArray(completed) ? completed : [];
}

function getLatestCompletedMatch() {
  const completed = readCompletedMatches();
  if (!completed.length) return null;
  return completed[completed.length - 1] || null;
}

function isFinishedMatch(match) {
  if (!match || typeof match !== 'object') return false;
  return match.status === 'finished' || match.status === 'completed' || match.status === 'final' || !!match.finishedAt;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function extractTeamNameValue(teamValue) {
  if (!teamValue) return '';
  if (typeof teamValue === 'string') return teamValue;
  if (typeof teamValue === 'object') {
    return teamValue.name || teamValue.teamName || '';
  }
  return '';
}

function extractTeamIdValue(teamValue) {
  if (!teamValue || typeof teamValue !== 'object') return null;
  return teamValue.id || teamValue.teamId || null;
}

function hasPositiveNumeric(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

function getSortableRating(player) {
  if (!player || typeof player !== 'object') return null;
  if (hasPositiveNumeric(player.rating)) return Number(player.rating);
  if (hasPositiveNumeric(player.customRating)) return Number(player.customRating);
  return null;
}

function sortPlayersBestToWorst(playersList) {
  if (!Array.isArray(playersList)) return [];
  return [...playersList].sort((a, b) => {
    const aRating = getSortableRating(a);
    const bRating = getSortableRating(b);

    if (aRating != null && bRating != null && bRating !== aRating) return bRating - aRating;
    if (aRating != null && bRating == null) return -1;
    if (aRating == null && bRating != null) return 1;

    const aAdr = toNumber(a?.adr, 0);
    const bAdr = toNumber(b?.adr, 0);
    if (bAdr !== aAdr) return bAdr - aAdr;

    const aKpr = toNumber(a?.kpr, 0);
    const bKpr = toNumber(b?.kpr, 0);
    if (bKpr !== aKpr) return bKpr - aKpr;

    const aKills = toNumber(a?.kills, 0);
    const bKills = toNumber(b?.kills, 0);
    if (bKills !== aKills) return bKills - aKills;

    const aPlusMinus = toNumber(a?.plusMinus, 0);
    const bPlusMinus = toNumber(b?.plusMinus, 0);
    if (bPlusMinus !== aPlusMinus) return bPlusMinus - aPlusMinus;

    return toNumber(a?.deaths, 0) - toNumber(b?.deaths, 0);
  });
}

function isPlayerInTeam(player, { teamId = null, teamName = '', side = '' } = {}) {
  if (!player || typeof player !== 'object') return false;

  const playerTeamId = player.teamId != null ? String(player.teamId).toLowerCase() : '';
  const targetTeamId = teamId != null ? String(teamId).toLowerCase() : '';
  if (playerTeamId && targetTeamId && playerTeamId === targetTeamId) return true;

  const playerTeamName = (player.teamName || '').toString().trim().toLowerCase();
  const targetTeamName = (teamName || '').toString().trim().toLowerCase();
  if (playerTeamName && targetTeamName && playerTeamName === targetTeamName) return true;

  const playerSide = (player.side || '').toString().trim().toUpperCase();
  const targetSide = (side || '').toString().trim().toUpperCase();
  if (playerSide && targetSide && playerSide === targetSide) return true;

  return false;
}

function calculateScoreboardCustomRating({ kills, adr, assists, survivalRate, multiKillRounds, deaths }) {
  const rating =
    (toNumber(kills, 0) * 0.35) +
    (toNumber(adr, 0) * 0.02) +
    (toNumber(assists, 0) * 0.1) +
    (toNumber(survivalRate, 0) * 0.01) +
    (toNumber(multiKillRounds, 0) * 0.2) -
    (toNumber(deaths, 0) * 0.15);
  return parseFloat(rating.toFixed(2));
}

function buildTopList(playersList, selector, { limit = 5 } = {}) {
  if (!Array.isArray(playersList)) return [];
  return [...playersList]
    .map((player) => ({ player, value: selector(player) }))
    .filter((entry) => entry.value !== null && entry.value !== undefined && Number.isFinite(Number(entry.value)))
    .sort((a, b) => {
      const diff = Number(b.value) - Number(a.value);
      if (diff !== 0) return diff;
      return toNumber(a.player?.deaths, 0) - toNumber(b.player?.deaths, 0);
    })
    .slice(0, limit)
    .map((entry) => normalizeTopPlayerEntry({
      id: entry.player?.id,
      name: entry.player?.name,
      nickname: entry.player?.nickname,
      photo: entry.player?.photo,
      teamId: entry.player?.teamId,
      teamLogo: entry.player?.teamLogo,
      value: Number(entry.value)
    }));
}

function safeDivide(numerator, denominator, digits = 2) {
  if (!denominator) return numerator;
  return parseFloat((numerator / denominator).toFixed(digits));
}

function normalizeSteamId(value) {
  return value ? String(value).trim().toLowerCase() : '';
}

function getBaseUrl(req) {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || `localhost:${port}`;
  return `${protocol}://${host}`;
}

function getPlayerFirstName(player) {
  return player?.firstName || player?.['First Name'] || player?.firstname || player?.FirstName || null;
}

function getPlayerLastName(player) {
  return player?.lastName || player?.['Last Name'] || player?.lastname || player?.LastName || null;
}

function getPlayerCountryCode(player) {
  return (player?.countryCode || player?.['Country Code'] || player?.country_code || player?.country || '').toString().trim().toUpperCase() || null;
}

function getPlayerNickname(player) {
  return player?.nickname || player?.name || player?.player || player?.nick || '';
}

function buildPlayerFullName(player) {
  const firstName = getPlayerFirstName(player);
  const lastName = getPlayerLastName(player);
  const nickname = getPlayerNickname(player);
  return player?.fullName || player?.['Full Name'] || player?.fullname || (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || nickname);
}

function buildScoreboardOverallPlayer({
  steamId,
  sourcePlayer,
  regPlayer,
  teamProfile,
  side,
  roundsPlayed,
  completedRounds,
  roundStats,
  baseUrl
}) {
  const kills = toNumber(sourcePlayer?.kills ?? sourcePlayer?.match_stats?.kills, 0);
  const deaths = toNumber(sourcePlayer?.deaths ?? sourcePlayer?.match_stats?.deaths, 0);
  const assists = toNumber(sourcePlayer?.assists ?? sourcePlayer?.match_stats?.assists, 0);
  const tracked = sourcePlayer?._tracked || {};
  const trackedDamageByRound = Array.isArray(tracked?.roundStats?.damageByRound) ? tracked.roundStats.damageByRound : null;
  const fallbackDamageByRound = Array.isArray(roundStats?.damageByRound) ? roundStats.damageByRound : [];
  const damageByRound = trackedDamageByRound || fallbackDamageByRound;
  const trackedDamageTotal = Number.isFinite(Number(tracked.damageTotal ?? tracked.matchStats?.damageTotal))
    ? toNumber(tracked.damageTotal ?? tracked.matchStats?.damageTotal, 0)
    : null;
  const fallbackDamageTotal = Number.isFinite(Number(sourcePlayer?.accumulatedDmg))
    ? toNumber(sourcePlayer.accumulatedDmg, 0)
    : damageByRound.reduce((sum, value) => sum + toNumber(value, 0), 0);
  const damageTotal = trackedDamageTotal != null ? trackedDamageTotal : fallbackDamageTotal;
  const damageCurrentRoundRaw = tracked.damageCurrentRound ?? sourcePlayer?.state?.round_totaldmg ?? null;
  const damageCurrentRound = Number.isFinite(Number(damageCurrentRoundRaw)) ? toNumber(damageCurrentRoundRaw, 0) : null;
  const damagePreviousRoundRaw = tracked.previousRoundDamage
    ?? (Array.isArray(damageByRound) && damageByRound.length > 0 ? damageByRound[damageByRound.length - 1] : null);
  const damagePreviousRound = Number.isFinite(Number(damagePreviousRoundRaw)) ? toNumber(damagePreviousRoundRaw, 0) : null;
  const damage = damageTotal;
  const plusMinus = kills - deaths;
  const kd = deaths > 0 ? parseFloat((kills / deaths).toFixed(2)) : kills;
  const roundsForRates = completedRounds > 0 ? completedRounds : roundsPlayed;
  const adr = roundsForRates > 0 ? parseFloat((damage / roundsForRates).toFixed(2)) : 0;
  const kpr = roundsForRates > 0 ? parseFloat((kills / roundsForRates).toFixed(3)) : 0;
  const apr = roundsForRates > 0 ? parseFloat((assists / roundsForRates).toFixed(3)) : 0;
  const dpr = roundsForRates > 0 ? parseFloat((deaths / roundsForRates).toFixed(3)) : 0;
  const kda = deaths > 0 ? parseFloat(((kills + assists) / deaths).toFixed(2)) : (kills + assists);
  const damagePerKill = kills > 0 ? parseFloat((damage / kills).toFixed(2)) : 0;

  const survivedCumulative = sourcePlayer?.match_stats?.survived_rounds ?? sourcePlayer?.match_stats?.survivedRounds;
  const survivedRounds = Number.isFinite(Number(survivedCumulative))
    ? toNumber(survivedCumulative, 0)
    : (Array.isArray(roundStats?.survivedByRound) ? roundStats.survivedByRound.filter((value) => value === true).length : 0);
  const survivalRate = roundsPlayed > 0 ? parseFloat(((survivedRounds / roundsPlayed) * 100).toFixed(2)) : 0;

  const trackedMultiAvailable = Number.isFinite(Number(tracked.multiKills_1k))
    || Number.isFinite(Number(tracked.multiKills_2k))
    || Number.isFinite(Number(tracked.multiKills_3k))
    || Number.isFinite(Number(tracked.multiKills_4k))
    || Number.isFinite(Number(tracked.multiKills_5k));

  const oneKillRounds = trackedMultiAvailable
    ? toNumber(tracked.multiKills_1k, 0)
    : (Array.isArray(roundStats?.killsByRound)
      ? roundStats.killsByRound.filter((value) => value === 1).length
      : toNumber(sourcePlayer?.match_stats?.oneKillRounds ?? sourcePlayer?.multiKills?.oneKillRounds, 0));
  const twoKCount = trackedMultiAvailable
    ? toNumber(tracked.multiKills_2k, 0)
    : (Array.isArray(roundStats?.killsByRound)
      ? roundStats.killsByRound.filter((value) => value === 2).length
      : toNumber(sourcePlayer?.match_stats?.twoKillRounds ?? sourcePlayer?.multiKills?.twoKCount ?? sourcePlayer?.multiKills?.twoKillRounds, 0));
  const threeKCount = trackedMultiAvailable
    ? toNumber(tracked.multiKills_3k, 0)
    : (Array.isArray(roundStats?.killsByRound)
      ? roundStats.killsByRound.filter((value) => value === 3).length
      : toNumber(sourcePlayer?.match_stats?.threeKillRounds ?? sourcePlayer?.multiKills?.threeKCount ?? sourcePlayer?.multiKills?.threeKillRounds, 0));
  const fourKCount = trackedMultiAvailable
    ? toNumber(tracked.multiKills_4k, 0)
    : (Array.isArray(roundStats?.killsByRound)
      ? roundStats.killsByRound.filter((value) => value === 4).length
      : toNumber(sourcePlayer?.match_stats?.fourKillRounds ?? sourcePlayer?.multiKills?.fourKCount ?? sourcePlayer?.multiKills?.fourKillRounds, 0));
  const fiveKCount = trackedMultiAvailable
    ? toNumber(tracked.multiKills_5k, 0)
    : (Array.isArray(roundStats?.killsByRound)
      ? roundStats.killsByRound.filter((value) => value >= 5).length
      : toNumber(sourcePlayer?.match_stats?.fiveKillRounds ?? sourcePlayer?.multiKills?.fiveKCount ?? sourcePlayer?.multiKills?.fiveKillRounds, 0));
  const totalMultiKillRounds = twoKCount + threeKCount + fourKCount + fiveKCount;

  const headshotsCountRaw = tracked.hasRoundKillHsField
    ? toNumber(tracked.headshots, 0)
    : (sourcePlayer?.match_stats?.headshots ?? sourcePlayer?.headshots?.count ?? null);
  const headshotsAvailable = tracked.hasRoundKillHsField || Number.isFinite(Number(sourcePlayer?.match_stats?.headshots ?? sourcePlayer?.headshots?.count));
  const headshotsCount = headshotsAvailable ? toNumber(headshotsCountRaw, 0) : null;
  const headshotRate = headshotsAvailable && kills > 0 ? parseFloat(((headshotsCount / kills) * 100).toFixed(2)) : null;

  // Opening kills: prefer tracked delta, then match_stats fallback
  const trackedFirstKills = Number.isFinite(Number(tracked.firstKills)) ? toNumber(tracked.firstKills, 0) : null;
  const trackedFirstDeaths = Number.isFinite(Number(tracked.firstDeaths)) ? toNumber(tracked.firstDeaths, 0) : null;
  const firstKillsRaw  = trackedFirstKills != null
    ? trackedFirstKills
    : (sourcePlayer?.match_stats?.firstKills  ?? sourcePlayer?.opening?.firstKills  ?? null);
  const firstDeathsRaw = trackedFirstDeaths != null
    ? trackedFirstDeaths
    : (sourcePlayer?.match_stats?.firstDeaths ?? sourcePlayer?.opening?.firstDeaths ?? null);
  const openingAvailable = trackedFirstKills != null || Number.isFinite(Number(sourcePlayer?.match_stats?.firstKills ?? sourcePlayer?.opening?.firstKills));
  const firstKills  = openingAvailable ? toNumber(firstKillsRaw,  0) : null;
  const firstDeaths = Number.isFinite(Number(firstDeathsRaw)) ? toNumber(firstDeathsRaw, 0) : null;
  const openingKpr  = openingAvailable && roundsForRates > 0 ? parseFloat((firstKills  / roundsForRates).toFixed(3)) : null;
  const entryDiff   = openingAvailable && firstDeaths != null ? firstKills - firstDeaths : null;

  const utilityAvailable = false;

  const clutchFromSource = sourcePlayer?.clutches || {};
  const trackedClutchAttempts = Number.isFinite(Number(tracked.clutches_attempts)) ? toNumber(tracked.clutches_attempts, 0) : null;
  const clutchesAttempts = trackedClutchAttempts != null
    ? trackedClutchAttempts
    : (Number.isFinite(Number(sourcePlayer?.clutches_attempts ?? clutchFromSource.attempts)) ? toNumber(sourcePlayer?.clutches_attempts ?? clutchFromSource.attempts, 0) : null);
  const clutchesWins = Number.isFinite(Number(tracked.clutches_wins))
    ? toNumber(tracked.clutches_wins, 0)
    : (Number.isFinite(Number(sourcePlayer?.clutches_wins ?? clutchFromSource.wins)) ? toNumber(sourcePlayer?.clutches_wins ?? clutchFromSource.wins, 0) : null);
  const clutchesLosses = Number.isFinite(Number(tracked.clutches_losses))
    ? toNumber(tracked.clutches_losses, 0)
    : (Number.isFinite(Number(sourcePlayer?.clutches_losses ?? clutchFromSource.losses))
      ? toNumber(sourcePlayer?.clutches_losses ?? clutchFromSource.losses, 0)
      : (clutchesAttempts != null && clutchesWins != null ? Math.max(0, clutchesAttempts - clutchesWins) : null));

  const readClutchNumber = (...values) => {
    for (const value of values) {
      if (Number.isFinite(Number(value))) return toNumber(value, 0);
    }
    return null;
  };

  const clutches1v1Attempts = readClutchNumber(tracked.clutches_1v1_attempts, sourcePlayer?.clutches_1v1_attempts, clutchFromSource.oneVsOne);
  const clutches1v2Attempts = readClutchNumber(tracked.clutches_1v2_attempts, sourcePlayer?.clutches_1v2_attempts, clutchFromSource.oneVsTwo);
  const clutches1v3Attempts = readClutchNumber(tracked.clutches_1v3_attempts, sourcePlayer?.clutches_1v3_attempts, clutchFromSource.oneVsThree);
  const clutches1v4Attempts = readClutchNumber(tracked.clutches_1v4_attempts, sourcePlayer?.clutches_1v4_attempts, clutchFromSource.oneVsFour);
  const clutches1v5Attempts = readClutchNumber(tracked.clutches_1v5_attempts, sourcePlayer?.clutches_1v5_attempts, clutchFromSource.oneVsFive);

  const clutches1v1Wins = readClutchNumber(tracked.clutches_1v1_wins, sourcePlayer?.clutches_1v1_wins, clutchFromSource.oneVsOneWins);
  const clutches1v2Wins = readClutchNumber(tracked.clutches_1v2_wins, sourcePlayer?.clutches_1v2_wins, clutchFromSource.oneVsTwoWins);
  const clutches1v3Wins = readClutchNumber(tracked.clutches_1v3_wins, sourcePlayer?.clutches_1v3_wins, clutchFromSource.oneVsThreeWins);
  const clutches1v4Wins = readClutchNumber(tracked.clutches_1v4_wins, sourcePlayer?.clutches_1v4_wins, clutchFromSource.oneVsFourWins);
  const clutches1v5Wins = readClutchNumber(tracked.clutches_1v5_wins, sourcePlayer?.clutches_1v5_wins, clutchFromSource.oneVsFiveWins);

  const clutches1v1Losses = readClutchNumber(tracked.clutches_1v1_losses, sourcePlayer?.clutches_1v1_losses, clutchFromSource.oneVsOneLosses);
  const clutches1v2Losses = readClutchNumber(tracked.clutches_1v2_losses, sourcePlayer?.clutches_1v2_losses, clutchFromSource.oneVsTwoLosses);
  const clutches1v3Losses = readClutchNumber(tracked.clutches_1v3_losses, sourcePlayer?.clutches_1v3_losses, clutchFromSource.oneVsThreeLosses);
  const clutches1v4Losses = readClutchNumber(tracked.clutches_1v4_losses, sourcePlayer?.clutches_1v4_losses, clutchFromSource.oneVsFourLosses);
  const clutches1v5Losses = readClutchNumber(tracked.clutches_1v5_losses, sourcePlayer?.clutches_1v5_losses, clutchFromSource.oneVsFiveLosses);

  const clutchesAvailable = clutchesAttempts != null;
  const clutchWinRate = clutchesAttempts > 0 && clutchesWins != null
    ? parseFloat(((clutchesWins / clutchesAttempts) * 100).toFixed(2))
    : null;

  const weaponsAvailable = !!tracked.weaponTrackingAvailable;
  const weaponsRaw = {
    awpKills:    weaponsAvailable ? toNumber(tracked.awpKills, 0)    : null,
    rifleKills:  weaponsAvailable ? toNumber(tracked.rifleKills, 0)  : null,
    knifeKills:  weaponsAvailable ? toNumber(tracked.knifeKills, 0)  : null,
    zeusKills:   weaponsAvailable ? toNumber(tracked.zeusKills, 0)   : null,
    pistolKills: weaponsAvailable ? toNumber(tracked.pistolKills, 0) : null,
    smgKills:    weaponsAvailable ? toNumber(tracked.smgKills, 0)    : null
  };
  const awpKills = weaponsRaw.awpKills;
  const awpKpr   = awpKills != null && roundsForRates > 0 ? parseFloat((awpKills / roundsForRates).toFixed(3)) : null;
  const weaponUnknownKills = weaponsAvailable ? toNumber(tracked.weaponUnknownKills, 0) : null;

  const kast = null;
  const impact = null;

  const ratingRaw = sourcePlayer?.match_stats?.rating ?? sourcePlayer?.rating ?? null;
  const rating = Number.isFinite(Number(ratingRaw)) ? toNumber(ratingRaw, 0) : 0;
  const customRating = calculateScoreboardCustomRating({
    kills,
    adr,
    assists,
    survivalRate,
    multiKillRounds: totalMultiKillRounds,
    deaths
  });

  const playerTeamId = sourcePlayer?.teamId ?? regPlayer?.teamId ?? teamProfile?.id ?? null;
  const playerTeamName = sourcePlayer?.teamName || teamProfile?.name || '';
  const playerTeamLogo = sourcePlayer?.teamLogo || teamProfile?.logo || '';

  return normalizePlayerStatsShape({
    id: sourcePlayer?.id || regPlayer?.id || `temp_${steamId}`,
    steamId: steamId || sourcePlayer?.steamId || regPlayer?.steamId || '',
    nickname: sourcePlayer?.nickname || regPlayer?.nickname || regPlayer?.name || sourcePlayer?.name || 'Unknown',
    name: sourcePlayer?.name || regPlayer?.name || sourcePlayer?.nickname || 'Unknown',
    photo: sourcePlayer?.photo || graphicsUtils.resolvePlayerPhoto(regPlayer || sourcePlayer, baseUrl, ''),
    teamId: playerTeamId,
    teamName: playerTeamName,
    teamLogo: playerTeamLogo,
    side: side || sourcePlayer?.side || '',
    kills,
    deaths,
    assists,
    plusMinus,
    kd,
    dpr,
    kda,
    damage,
    damageTotal,
    damageCurrentRound,
    damagePreviousRound,
    damageByRound,
    adr,
    kpr,
    apr,
    damagePerKill,
    rating,
    customRating,
    impact,
    roundsPlayed,
    survivedRounds,
    survivalRate,
    survivedRoundsCount: survivedRounds,
    survivalPercentage: survivalRate,
    kast,
    kastPercentage: kast,
    multiKills: {
      oneKillRounds,
      twoKillRounds: twoKCount,
      threeKillRounds: threeKCount,
      fourKillRounds: fourKCount,
      fiveKillRounds: fiveKCount,
      twoKCount,
      threeKCount,
      fourKCount,
      fiveKCount,
      aces: fiveKCount,
      totalMultiKillRounds
    },
    multiKills_1k: oneKillRounds,
    multiKills_2k: twoKCount,
    multiKills_3k: threeKCount,
    multiKills_4k: fourKCount,
    multiKills_5k: fiveKCount,
    multiKills_aces: fiveKCount,
    multiKills_total: totalMultiKillRounds,
    headshots: {
      count: headshotsCount,
      rate: headshotRate,
      percentage: headshotRate,
      available: headshotsAvailable
    },
    headshots_count: headshotsCount,
    headshots_rate: headshotRate,
    headshots_percentage: headshotRate,
    hsCount: headshotsCount,
    hsPercentage: headshotRate,
    opening: {
      firstKills,
      firstDeaths,
      openingKpr,
      entryDiff,
      available: openingAvailable
    },
    opening_firstKills: firstKills,
    opening_firstDeaths: firstDeaths,
    opening_kpr: openingKpr,
    opening_entryDiff: entryDiff,
    openingKpr,
    weapons: {
      awpKills,
      awpKpr,
      rifleKills: weaponsAvailable && Number.isFinite(Number(weaponsRaw.rifleKills)) ? toNumber(weaponsRaw.rifleKills, 0) : null,
      knifeKills: weaponsAvailable && Number.isFinite(Number(weaponsRaw.knifeKills)) ? toNumber(weaponsRaw.knifeKills, 0) : null,
      zeusKills: weaponsAvailable && Number.isFinite(Number(weaponsRaw.zeusKills)) ? toNumber(weaponsRaw.zeusKills, 0) : null,
      pistolKills: weaponsAvailable && Number.isFinite(Number(weaponsRaw.pistolKills)) ? toNumber(weaponsRaw.pistolKills, 0) : null,
      smgKills: weaponsAvailable && Number.isFinite(Number(weaponsRaw.smgKills)) ? toNumber(weaponsRaw.smgKills, 0) : null,
      unknownKills: weaponUnknownKills,
      available: weaponsAvailable
    },
    awpKills,
    awpKpr,
    rifleKills: weaponsAvailable && Number.isFinite(Number(weaponsRaw.rifleKills)) ? toNumber(weaponsRaw.rifleKills, 0) : null,
    knifeKills: weaponsAvailable && Number.isFinite(Number(weaponsRaw.knifeKills)) ? toNumber(weaponsRaw.knifeKills, 0) : null,
    zeusKills: weaponsAvailable && Number.isFinite(Number(weaponsRaw.zeusKills)) ? toNumber(weaponsRaw.zeusKills, 0) : null,
    pistolKills: weaponsAvailable && Number.isFinite(Number(weaponsRaw.pistolKills)) ? toNumber(weaponsRaw.pistolKills, 0) : null,
    smgKills: weaponsAvailable && Number.isFinite(Number(weaponsRaw.smgKills)) ? toNumber(weaponsRaw.smgKills, 0) : null,
    weaponUnknownKills,
    utility: {
      flashAssists: null,
      flashesThrown: null,
      enemiesFlashed: null,
      smokesThrown: null,
      heThrown: null,
      molotovsThrown: null,
      utilityDamage: null,
      available: utilityAvailable
    },
    clutches: {
      attempts: clutchesAttempts,
      wins: clutchesWins,
      losses: clutchesLosses,
      oneVsOne: clutches1v1Attempts,
      oneVsTwo: clutches1v2Attempts,
      oneVsThree: clutches1v3Attempts,
      oneVsFour: clutches1v4Attempts,
      oneVsFive: clutches1v5Attempts,
      oneVsOneWins: clutches1v1Wins,
      oneVsTwoWins: clutches1v2Wins,
      oneVsThreeWins: clutches1v3Wins,
      oneVsFourWins: clutches1v4Wins,
      oneVsFiveWins: clutches1v5Wins,
      oneVsOneLosses: clutches1v1Losses,
      oneVsTwoLosses: clutches1v2Losses,
      oneVsThreeLosses: clutches1v3Losses,
      oneVsFourLosses: clutches1v4Losses,
      oneVsFiveLosses: clutches1v5Losses,
      winRate: clutchWinRate,
      available: clutchesAvailable
    },
    clutches_attempts: clutchesAttempts,
    clutches_wins: clutchesWins,
    clutches_losses: clutchesLosses,
    clutches_1v1_attempts: clutches1v1Attempts,
    clutches_1v1_wins: clutches1v1Wins,
    clutches_1v1_losses: clutches1v1Losses,
    clutches_1v2_attempts: clutches1v2Attempts,
    clutches_1v2_wins: clutches1v2Wins,
    clutches_1v2_losses: clutches1v2Losses,
    clutches_1v3_attempts: clutches1v3Attempts,
    clutches_1v3_wins: clutches1v3Wins,
    clutches_1v3_losses: clutches1v3Losses,
    clutches_1v4_attempts: clutches1v4Attempts,
    clutches_1v4_wins: clutches1v4Wins,
    clutches_1v4_losses: clutches1v4Losses,
    clutches_1v5_attempts: clutches1v5Attempts,
    clutches_1v5_wins: clutches1v5Wins,
    clutches_1v5_losses: clutches1v5Losses,
    clutches_oneVsOne: clutches1v1Attempts,
    clutches_oneVsTwo: clutches1v2Attempts,
    clutches_oneVsThree: clutches1v3Attempts,
    clutches_oneVsFour: clutches1v4Attempts,
    clutches_oneVsFive: clutches1v5Attempts,
    clutchWinRate,
    flashAssists: null,
    flashesThrown: null,
    enemiesFlashed: null,
    smokesThrown: null,
    heThrown: null,
    molotovsThrown: null,
    utilityDamage: null,
    scoreboardRank: null,
    roundStats: {
      killsByRound: roundStats?.killsByRound || [],
      damageByRound: damageByRound || [],
      survivedByRound: roundStats?.survivedByRound || [],
      kastByRound: roundStats?.kastByRound || []
    },
    availability: {
      basic: true,
      damage: true,
      multiKills: true,
      headshots: headshotsAvailable,
      opening: openingAvailable,
      weapons: weaponsAvailable,
      utility: utilityAvailable,
      clutches: clutchesAvailable,
      kast: kast != null,
      impact: impact != null
    },
    isPlaceholder: false
  }, { placeholder: false });
}

function buildOverallTopPlayers(playersList) {
  const top = {
    rating: buildTopList(playersList, (p) => p.rating > 0 ? p.rating : p.customRating),
    kills: buildTopList(playersList, (p) => p.kills),
    adr: buildTopList(playersList, (p) => p.adr),
    kpr: buildTopList(playersList, (p) => p.kpr),
    apr: buildTopList(playersList, (p) => p.apr),
    impact: buildTopList(playersList, (p) => (p.availability?.impact ? p.impact : null)),
    kast: buildTopList(playersList, (p) => (p.availability?.kast ? p.kast : null)),
    survivalRate: buildTopList(playersList, (p) => p.survivalRate),
    headshotRate: buildTopList(playersList, (p) => (p.headshots?.available ? p.headshots.rate : null)),
    openingKpr: buildTopList(playersList, (p) => (p.opening?.available ? p.opening.openingKpr : null)),
    flashAssists: buildTopList(playersList, (p) => (p.utility?.available ? p.utility.flashAssists : null)),
    awpKills: buildTopList(playersList, (p) => (p.weapons?.available ? p.weapons.awpKills : null)),
    rifleKills: buildTopList(playersList, (p) => (p.weapons?.available ? p.weapons.rifleKills : null)),
    multiKills: buildTopList(playersList, (p) => p.multiKills?.totalMultiKillRounds)
  };
  return top;
}

function buildOverallStatAvailability(playersList) {
  const source = Array.isArray(playersList) ? playersList : [];
  return {
    basic: true,
    damage: true,
    multiKills: true,
    headshots: source.some((p) => p.headshots?.available),
    opening: source.some((p) => p.opening?.available),
    weapons: source.some((p) => p.weapons?.available),
    utility: source.some((p) => p.utility?.available),
    kast: source.some((p) => p.availability?.kast),
    impact: source.some((p) => p.availability?.impact)
  };
}

function toScoreboardTableRow(player) {
  const source = player || {};
  return {
    steamId: source.steamId || '',
    nickname: source.nickname || source.name || '',
    teamName: source.teamName || '',
    side: source.side || '',
    kills: toNumber(source.kills, 0),
    deaths: toNumber(source.deaths, 0),
    assists: toNumber(source.assists, 0),
    plusMinus: toNumber(source.plusMinus, 0),
    kd: toNumber(source.kd, 0),
    dpr: toNumber(source.dpr, 0),
    kda: toNumber(source.kda, 0),
    damageTotal: toNumber(source.damageTotal ?? source.damage, 0),
    damageCurrentRound: source.damageCurrentRound != null ? toNumber(source.damageCurrentRound, 0) : null,
    damagePreviousRound: source.damagePreviousRound != null ? toNumber(source.damagePreviousRound, 0) : null,
    adr: toNumber(source.adr, 0),
    kpr: toNumber(source.kpr, 0),
    apr: toNumber(source.apr, 0),
    roundsPlayed: toNumber(source.roundsPlayed, 0),
    survivedRounds: toNumber(source.survivedRounds, 0),
    survivalRate: toNumber(source.survivalRate, 0),
    multiKills_1k: toNumber(source.multiKills_1k, 0),
    multiKills_2k: toNumber(source.multiKills_2k, 0),
    multiKills_3k: toNumber(source.multiKills_3k, 0),
    multiKills_4k: toNumber(source.multiKills_4k, 0),
    multiKills_5k: toNumber(source.multiKills_5k, 0),
    multiKills_aces: toNumber(source.multiKills_aces, 0),
    multiKills_total: toNumber(source.multiKills_total, 0),
    hsCount: source.hsCount != null ? toNumber(source.hsCount, 0) : null,
    hsPercentage: source.hsPercentage != null ? toNumber(source.hsPercentage, 0) : null,
    opening_firstKills: source.opening_firstKills != null ? toNumber(source.opening_firstKills, 0) : null,
    opening_firstDeaths: source.opening_firstDeaths != null ? toNumber(source.opening_firstDeaths, 0) : null,
    openingKpr: source.openingKpr != null ? toNumber(source.openingKpr, 0) : null,
    opening_entryDiff: source.opening_entryDiff != null ? toNumber(source.opening_entryDiff, 0) : null,
    awpKills: source.awpKills != null ? toNumber(source.awpKills, 0) : null,
    awpKpr: source.awpKpr != null ? toNumber(source.awpKpr, 0) : null,
    rifleKills: source.rifleKills != null ? toNumber(source.rifleKills, 0) : null,
    pistolKills: source.pistolKills != null ? toNumber(source.pistolKills, 0) : null,
    knifeKills: source.knifeKills != null ? toNumber(source.knifeKills, 0) : null,
    zeusKills: source.zeusKills != null ? toNumber(source.zeusKills, 0) : null,
    smgKills: source.smgKills != null ? toNumber(source.smgKills, 0) : null,
    weaponUnknownKills: source.weaponUnknownKills != null ? toNumber(source.weaponUnknownKills, 0) : null,
    clutches_attempts: source.clutches_attempts != null ? toNumber(source.clutches_attempts, 0) : null,
    clutches_wins: source.clutches_wins != null ? toNumber(source.clutches_wins, 0) : null,
    clutches_losses: source.clutches_losses != null ? toNumber(source.clutches_losses, 0) : null,
    clutches_1v1_attempts: source.clutches_1v1_attempts != null ? toNumber(source.clutches_1v1_attempts, 0) : null,
    clutches_1v1_wins: source.clutches_1v1_wins != null ? toNumber(source.clutches_1v1_wins, 0) : null,
    clutches_1v1_losses: source.clutches_1v1_losses != null ? toNumber(source.clutches_1v1_losses, 0) : null,
    clutches_1v2_attempts: source.clutches_1v2_attempts != null ? toNumber(source.clutches_1v2_attempts, 0) : null,
    clutches_1v2_wins: source.clutches_1v2_wins != null ? toNumber(source.clutches_1v2_wins, 0) : null,
    clutches_1v2_losses: source.clutches_1v2_losses != null ? toNumber(source.clutches_1v2_losses, 0) : null,
    clutches_1v3_attempts: source.clutches_1v3_attempts != null ? toNumber(source.clutches_1v3_attempts, 0) : null,
    clutches_1v3_wins: source.clutches_1v3_wins != null ? toNumber(source.clutches_1v3_wins, 0) : null,
    clutches_1v3_losses: source.clutches_1v3_losses != null ? toNumber(source.clutches_1v3_losses, 0) : null,
    clutches_1v4_attempts: source.clutches_1v4_attempts != null ? toNumber(source.clutches_1v4_attempts, 0) : null,
    clutches_1v4_wins: source.clutches_1v4_wins != null ? toNumber(source.clutches_1v4_wins, 0) : null,
    clutches_1v4_losses: source.clutches_1v4_losses != null ? toNumber(source.clutches_1v4_losses, 0) : null,
    clutches_1v5_attempts: source.clutches_1v5_attempts != null ? toNumber(source.clutches_1v5_attempts, 0) : null,
    clutches_1v5_wins: source.clutches_1v5_wins != null ? toNumber(source.clutches_1v5_wins, 0) : null,
    clutches_1v5_losses: source.clutches_1v5_losses != null ? toNumber(source.clutches_1v5_losses, 0) : null,
    clutchWinRate: source.clutchWinRate != null ? toNumber(source.clutchWinRate, 0) : null,
    customRating: toNumber(source.customRating, 0),
    scoreboardRank: source.scoreboardRank != null ? toNumber(source.scoreboardRank, null) : null,
    isPlaceholder: !!source.isPlaceholder
  };
}

function buildPlayersTableRows(playersList) {
  return (Array.isArray(playersList) ? playersList : []).map((player) => toScoreboardTableRow(player));
}

function buildStatsDebug({
  players,
  playersTable,
  rawScoreboardPlayers
}) {
  const sourcePlayers = Array.isArray(players) ? players : [];
  const table = Array.isArray(playersTable) ? playersTable : [];
  const raw = rawScoreboardPlayers && typeof rawScoreboardPlayers === 'object' ? rawScoreboardPlayers : {};

  const warnings = [];
  const unavailableStats = ['utility', 'kast', 'impact'];

  let hasRoundKills = false;
  let hasRoundKillHs = false;
  let hasRoundTotalDmg = false;
  let weaponTrackingAvailable = false;
  let trackedPlayersCount = 0;

  Object.values(raw).forEach((rawPlayer) => {
    if (!rawPlayer || typeof rawPlayer !== 'object') return;
    const tracked = rawPlayer._tracked || null;
    if (tracked) trackedPlayersCount += 1;

    if (Object.prototype.hasOwnProperty.call(rawPlayer?.state || {}, 'round_kills') || tracked?.hasRoundKillsField) {
      hasRoundKills = true;
    }
    if (Object.prototype.hasOwnProperty.call(rawPlayer?.state || {}, 'round_killhs') || tracked?.hasRoundKillHsField) {
      hasRoundKillHs = true;
    }
    if (Object.prototype.hasOwnProperty.call(rawPlayer?.state || {}, 'round_totaldmg') || tracked?.hasRoundTotalDmgField) {
      hasRoundTotalDmg = true;
    }
    if (tracked?.weaponTrackingAvailable) {
      weaponTrackingAvailable = true;
    }
    if (Array.isArray(tracked?.trackerWarnings) && tracked.trackerWarnings.length > 0) {
      tracked.trackerWarnings.forEach((entry) => warnings.push(entry));
    }
    if (Array.isArray(tracked?.clutchPendingRounds) && tracked.clutchPendingRounds.length > 0) {
      tracked.clutchPendingRounds.forEach((roundNo) => warnings.push(`clutch_pending_round_${roundNo}`));
    }
  });

  if (Array.isArray(clutchTrackerState?.unresolvedWarnings)) {
    clutchTrackerState.unresolvedWarnings.forEach((entry) => warnings.push(entry));
  }

  sourcePlayers.forEach((player) => {
    const steamId = player.steamId || player.id || 'unknown';
    const rawPlayer = raw[player.steamId] || null;

    if (rawPlayer && Number.isFinite(Number(rawPlayer?.match_stats?.kills))) {
      const gsiKills = toNumber(rawPlayer.match_stats.kills, 0);
      if (toNumber(player.kills, 0) !== gsiKills) {
        warnings.push(`kills_mismatch:${steamId}`);
      }
    }

    if (rawPlayer && Object.prototype.hasOwnProperty.call(rawPlayer?.state || {}, 'round_totaldmg')) {
      const gsiRoundDmg = toNumber(rawPlayer.state.round_totaldmg, 0);
      if (player.damageCurrentRound != null && toNumber(player.damageCurrentRound, 0) !== gsiRoundDmg) {
        warnings.push(`damageCurrentRound_mismatch:${steamId}`);
      }
    }

    if (player.hsCount != null && player.hsCount > player.kills) {
      warnings.push(`hs_gt_kills:${steamId}`);
    }

    if (!player.isPlaceholder && toNumber(player.roundsPlayed, 0) > 1 && player.damagePreviousRound == null) {
      warnings.push(`damagePreviousRound_missing:${steamId}`);
    }

    const weaponsTotal = [player.awpKills, player.rifleKills, player.pistolKills, player.knifeKills, player.zeusKills, player.smgKills, player.weaponUnknownKills]
      .reduce((sum, value) => sum + toNumber(value, 0), 0);
    if (weaponsTotal > toNumber(player.kills, 0)) {
      warnings.push(`weaponKills_gt_kills:${steamId}`);
    }

    const multiTotal = toNumber(player.multiKills_2k, 0) + toNumber(player.multiKills_3k, 0) + toNumber(player.multiKills_4k, 0) + toNumber(player.multiKills_5k, 0);
    if (toNumber(player.multiKills_total, 0) !== multiTotal) {
      warnings.push(`multikill_total_mismatch:${steamId}`);
    }
  });

  const totalAces = sourcePlayers.reduce((sum, player) => sum + toNumber(player.multiKills_aces, 0), 0);
  const maxReasonableAces = Math.max(0, ...sourcePlayers.map((player) => toNumber(player.roundsPlayed, 0)));
  if (totalAces > maxReasonableAces && maxReasonableAces > 0) {
    warnings.push(`aces_gt_rounds:${totalAces}>${maxReasonableAces}`);
  }

  table.forEach((row, index) => {
    for (const [key, value] of Object.entries(row || {})) {
      const type = typeof value;
      if (value !== null && type !== 'string' && type !== 'number' && type !== 'boolean') {
        warnings.push(`playersTable_non_primitive:${index}:${key}`);
      }
    }
  });

  return {
    trackedPlayersCount,
    hasRoundKills,
    hasRoundKillHs,
    hasRoundTotalDmg,
    weaponTrackingAvailable,
    unavailableStats,
    warnings: Array.from(new Set(warnings))
  };
}

function buildPlayerStatsSnapshot(steamId, baseUrl = '') {
  const gsiPlayer = scoreboard.players[steamId] || null;
  const regPlayer = players.find((player) => normalizeSteamId(player.steamId) === normalizeSteamId(steamId)) || null;
  const team = regPlayer ? teams.find((t) => t.id === regPlayer.teamId) : null;
  const side = gsiPlayer?.team || null;
  const kills = toNumber(gsiPlayer?.match_stats?.kills, toNumber(regPlayer?.match_stats?.kills, 0));
  const deaths = toNumber(gsiPlayer?.match_stats?.deaths, toNumber(regPlayer?.match_stats?.deaths, 0));
  const assists = toNumber(gsiPlayer?.match_stats?.assists, toNumber(regPlayer?.match_stats?.assists, 0));
  const damage = toNumber(gsiPlayer?.accumulatedDmg, toNumber(regPlayer?.match_stats?.damage, 0));
  const roundsPlayed = getRoundCount();
  const plusMinus = kills - deaths;
  const kd = deaths > 0 ? parseFloat((kills / deaths).toFixed(2)) : kills;
  const adr = roundsPlayed > 0 ? parseFloat((damage / roundsPlayed).toFixed(1)) : 0;
  const damagePerKill = kills > 0 ? parseFloat((damage / kills).toFixed(1)) : 0;
  const headshots = gsiPlayer?.match_stats?.headshots ?? regPlayer?.match_stats?.headshots ?? null;
  const headshotRate = headshots != null && kills > 0 ? parseFloat(((headshots / kills) * 100).toFixed(1)) : null;
  const oneKillRounds = gsiPlayer?.match_stats?.oneKillRounds ?? gsiPlayer?.match_stats?.multikills_1k ?? null;
  const twoKillRounds = gsiPlayer?.match_stats?.twoKillRounds ?? gsiPlayer?.match_stats?.multikills_2k ?? null;
  const threeKillRounds = gsiPlayer?.match_stats?.threeKillRounds ?? gsiPlayer?.match_stats?.multikills_3k ?? null;
  const fourKillRounds = gsiPlayer?.match_stats?.fourKillRounds ?? gsiPlayer?.match_stats?.multikills_4k ?? null;
  const fiveKillRounds = gsiPlayer?.match_stats?.fiveKillRounds ?? gsiPlayer?.match_stats?.multikills_5k ?? null;
  const totalMultiKillRounds = [oneKillRounds, twoKillRounds, threeKillRounds, fourKillRounds, fiveKillRounds]
    .reduce((sum, value) => sum + (value != null ? toNumber(value, 0) : 0), 0);
  const aces = fiveKillRounds != null ? toNumber(fiveKillRounds, 0) : null;
  const firstKills = gsiPlayer?.match_stats?.firstKills ?? regPlayer?.match_stats?.firstKills ?? null;
  const firstDeaths = gsiPlayer?.match_stats?.firstDeaths ?? regPlayer?.match_stats?.firstDeaths ?? null;
  const entryDiff = firstKills != null && firstDeaths != null ? firstKills - firstDeaths : null;
  const flashesThrown = gsiPlayer?.match_stats?.flashesThrown ?? gsiPlayer?.match_stats?.flashes_thrown ?? null;
  const enemiesFlashed = gsiPlayer?.match_stats?.enemiesFlashed ?? gsiPlayer?.match_stats?.enemies_flashed ?? null;
  const flashAssists = gsiPlayer?.match_stats?.flashAssists ?? gsiPlayer?.match_stats?.flash_assists ?? null;
  const smokesThrown = gsiPlayer?.match_stats?.smokesThrown ?? gsiPlayer?.match_stats?.smokes_thrown ?? null;
  const heThrown = gsiPlayer?.match_stats?.heThrown ?? gsiPlayer?.match_stats?.he_thrown ?? null;
  const molotovsThrown = gsiPlayer?.match_stats?.molotovsThrown ?? gsiPlayer?.match_stats?.molotovs_thrown ?? null;
  const decoysThrown = gsiPlayer?.match_stats?.decoysThrown ?? gsiPlayer?.match_stats?.decoys_thrown ?? null;
  const utilityDamage = gsiPlayer?.match_stats?.utilityDamage ?? gsiPlayer?.match_stats?.utility_damage ?? null;
  const money = gsiPlayer?.state?.money ?? gsiPlayer?.match_stats?.money ?? null;
  const equipmentValue = gsiPlayer?.state?.equipment_value ?? gsiPlayer?.match_stats?.equipmentValue ?? null;
  const spendThisRound = gsiPlayer?.state?.spend_this_round ?? gsiPlayer?.match_stats?.spendThisRound ?? null;
  const currentMatchStats = gsiPlayer?.match_stats || {};
  const sideStats = {
    CT: {
      rounds: toNumber(currentMatchStats.ct_rounds, 0),
      kills: toNumber(currentMatchStats.ct_kills, 0),
      deaths: toNumber(currentMatchStats.ct_deaths, 0),
      adr: toNumber(currentMatchStats.ct_rounds, 0) > 0 ? parseFloat((toNumber(currentMatchStats.ct_damage, 0) / toNumber(currentMatchStats.ct_rounds, 0)).toFixed(1)) : 0
    },
    T: {
      rounds: toNumber(currentMatchStats.t_rounds, 0),
      kills: toNumber(currentMatchStats.t_kills, 0),
      deaths: toNumber(currentMatchStats.t_deaths, 0),
      adr: toNumber(currentMatchStats.t_rounds, 0) > 0 ? parseFloat((toNumber(currentMatchStats.t_damage, 0) / toNumber(currentMatchStats.t_rounds, 0)).toFixed(1)) : 0
    }
  };
  const customRating = parseFloat((0.5 + ((kills * 0.35) + (assists * 0.1) - (deaths * 0.2) + (adr * 0.015) + (plusMinus * 0.05)) / 20).toFixed(2));
  const photo = graphicsUtils.resolvePlayerPhoto(regPlayer || { photo: gsiPlayer?.photo }, baseUrl, '/NoneP.png');
  const teamLogo = team ? graphicsUtils.resolveLogo(team, baseUrl, '/logos/none-team.png') : (regPlayer?.teamId ? graphicsUtils.resolveLogo(teams.find((t) => t.id === regPlayer.teamId), baseUrl, '/logos/none-team.png') : `${baseUrl}/logos/none-team.png`);

  return {
    id: regPlayer?.id || gsiPlayer?.id || `temp_${steamId}`,
    steamId: regPlayer?.steamId || steamId,
    nickname: getPlayerNickname(regPlayer || gsiPlayer) || gsiPlayer?.name || 'Unknown',
    name: getPlayerNickname(regPlayer || gsiPlayer) || gsiPlayer?.name || 'Unknown',
    firstName: getPlayerFirstName(regPlayer || gsiPlayer),
    lastName: getPlayerLastName(regPlayer || gsiPlayer),
    fullName: buildPlayerFullName(regPlayer || gsiPlayer),
    country: regPlayer?.country || gsiPlayer?.country || null,
    countryCode: getPlayerCountryCode(regPlayer || gsiPlayer),
    role: regPlayer?.role || gsiPlayer?.role || '',
    photo,
    teamId: regPlayer?.teamId || team?.id || null,
    teamName: team?.name || gsiPlayer?.teamName || (side === 'CT' ? scoreboard.map?.team_ct?.name : scoreboard.map?.team_t?.name) || null,
    teamLogo,
    side,
    kills,
    deaths,
    assists,
    kd,
    plusMinus,
    damage,
    adr,
    damagePerKill,
    roundsPlayed,
    headshots,
    headshotRate,
    multiKills: {
      oneKillRounds,
      twoKillRounds,
      threeKillRounds,
      fourKillRounds,
      fiveKillRounds,
      aces,
      totalMultiKillRounds
    },
    opening: {
      firstKills,
      firstDeaths,
      entryDiff
    },
    clutches: {
      attempts: null,
      wins: null,
      oneVsOne: null,
      oneVsTwo: null,
      oneVsThree: null,
      oneVsFour: null,
      oneVsFive: null
    },
    utility: {
      flashesThrown,
      enemiesFlashed,
      flashAssists,
      smokesThrown,
      heThrown,
      molotovsThrown,
      decoysThrown,
      utilityDamage
    },
    economy: {
      money,
      equipmentValue,
      spendThisRound
    },
    weaponStats: {},
    sideStats,
    rating: customRating,
    customRating
  };
}

function buildLivePlayerStatsSnapshot(steamId, livePlayer, currentMatch, baseUrl = '') {
  const regPlayer = players.find((player) => normalizeSteamId(player.steamId) === normalizeSteamId(steamId)) || null;
  const team = regPlayer ? teams.find((t) => t.id === regPlayer.teamId) : null;
  const kills = toNumber(livePlayer?.kills, 0);
  const deaths = toNumber(livePlayer?.deaths, 0);
  const assists = toNumber(livePlayer?.assists, 0);
  const damage = toNumber(livePlayer?.damage, 0);
  const roundsPlayed = toNumber(livePlayer?.rounds, currentMatch?.roundCount || getRoundCount());
  const plusMinus = kills - deaths;
  const kd = deaths > 0 ? parseFloat((kills / deaths).toFixed(2)) : kills;
  const adr = roundsPlayed > 0 ? parseFloat((damage / roundsPlayed).toFixed(1)) : 0;
  const damagePerKill = kills > 0 ? parseFloat((damage / kills).toFixed(1)) : 0;
  const headshots = livePlayer?.headshots ?? null;
  const headshotRate = headshots != null && kills > 0 ? parseFloat(((headshots / kills) * 100).toFixed(1)) : null;
  const multiKills = livePlayer?.threeKills != null || livePlayer?.fourKills != null || livePlayer?.fiveKills != null
    ? {
        oneKillRounds: livePlayer?.oneKillRounds ?? null,
        twoKillRounds: livePlayer?.twoKillRounds ?? null,
        threeKillRounds: livePlayer?.threeKills ?? null,
        fourKillRounds: livePlayer?.fourKills ?? null,
        fiveKillRounds: livePlayer?.fiveKills ?? null,
        aces: livePlayer?.fiveKills ?? null,
        totalMultiKillRounds: toNumber(livePlayer?.oneKillRounds, 0) + toNumber(livePlayer?.twoKillRounds, 0) + toNumber(livePlayer?.threeKills, 0) + toNumber(livePlayer?.fourKills, 0) + toNumber(livePlayer?.fiveKills, 0)
      }
    : DEFAULT_PLAYER_STATS.multiKills;

  return {
    ...DEFAULT_PLAYER_STATS,
    id: regPlayer?.id || livePlayer?.id || `temp_${steamId}`,
    steamId: regPlayer?.steamId || steamId,
    nickname: getPlayerNickname(regPlayer || livePlayer) || livePlayer?.name || 'Unknown',
    name: getPlayerNickname(regPlayer || livePlayer) || livePlayer?.name || 'Unknown',
    firstName: getPlayerFirstName(regPlayer || livePlayer),
    lastName: getPlayerLastName(regPlayer || livePlayer),
    fullName: buildPlayerFullName(regPlayer || livePlayer),
    country: regPlayer?.country || livePlayer?.country || null,
    countryCode: getPlayerCountryCode(regPlayer || livePlayer),
    role: regPlayer?.role || livePlayer?.role || '',
    photo: graphicsUtils.resolvePlayerPhoto(regPlayer || livePlayer, baseUrl),
    teamId: regPlayer?.teamId || team?.id || livePlayer?._teamId || null,
    teamName: team?.name || livePlayer?.teamName || livePlayer?._team || null,
    teamLogo: team ? graphicsUtils.resolveLogo(team, baseUrl) : `${baseUrl}/logos/none-team.png`,
    side: livePlayer?._team || null,
    kills,
    deaths,
    assists,
    kd,
    plusMinus,
    damage,
    adr,
    damagePerKill,
    roundsPlayed,
    headshots,
    headshotRate,
    multiKills,
    opening: {
      firstKills: livePlayer?.firstKills ?? null,
      firstDeaths: livePlayer?.firstDeaths ?? null,
      entryDiff: livePlayer?.firstKills != null && livePlayer?.firstDeaths != null ? livePlayer.firstKills - livePlayer.firstDeaths : null
    },
    utility: {
      flashesThrown: livePlayer?.flashesThrown ?? null,
      enemiesFlashed: livePlayer?.enemiesFlashed ?? null,
      flashAssists: livePlayer?.flashAssists ?? null,
      smokesThrown: livePlayer?.smokesThrown ?? null,
      heThrown: livePlayer?.heThrown ?? null,
      molotovsThrown: livePlayer?.molotovsThrown ?? null,
      decoysThrown: livePlayer?.decoysThrown ?? null,
      utilityDamage: livePlayer?.utilityDamage ?? null
    },
    economy: {
      money: livePlayer?.money ?? null,
      equipmentValue: livePlayer?.equipmentValue ?? null,
      spendThisRound: livePlayer?.spendThisRound ?? null
    },
    sideStats: livePlayer?.sideStats || DEFAULT_PLAYER_STATS.sideStats,
    rating: livePlayer?.galaxyRating ?? livePlayer?.rating ?? livePlayer?.customRating ?? 0,
    customRating: livePlayer?.galaxyRating ?? livePlayer?.rating ?? livePlayer?.customRating ?? 0
  };
}

function buildPlayerStatsPayload(mode, req, options = {}) {
  const baseUrl = getBaseUrl(req);
  const liveData = readJsonSafe(STORAGE_FILES.liveMatch, getIdleLiveMatch());
  const postmatchData = readJsonSafe(STORAGE_FILES.postmatch, getIdlePostmatch());
  const currentMatch = stats.getCurrentMatchStats();

  const isCompact = !!options.compact;
  const totalPlayerSlots = 10;
  const teamSlots = 5;

  const baseIdle = {
    mode,
    status: mode === 'live' ? 'idle' : 'idle',
    matchId: null,
    map: null,
    round: 0,
    updatedAt: '',
    players: createPlaceholderPlayers(totalPlayerSlots),
    teamAPlayers: createPlaceholderPlayers(teamSlots),
    teamBPlayers: createPlaceholderPlayers(teamSlots),
    topPlayers: buildStableTopPlayers(EMPTY_TOP_PLAYERS),
    mvp: null,
    teamA: null,
    teamB: null
  };

  const seen = new Set();
  const candidates = [];
  const addCandidate = (candidate) => {
    if (!candidate) return;
    const normalized = normalizePlayerStatsShape(candidate, { placeholder: !!candidate.isPlaceholder });
    const key = normalizeSteamId(normalized.steamId || normalized.id);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    candidates.push(normalized);
  };

  const buildKnownPlayersFromIds = (ids, sourceResolver) => {
    for (const steamId of ids) {
      const sourcePlayer = typeof sourceResolver === 'function' ? sourceResolver(steamId) : null;
      if (sourcePlayer) {
        addCandidate(sourcePlayer);
      } else {
        addCandidate(buildPlayerStatsSnapshot(steamId, baseUrl));
      }
    }
  };

  const liveFromScoreboard = Object.entries(scoreboard.players || {}).map(([steamId, player]) => ({
    id: player.id || null,
    steamId,
    nickname: player.name || player.nickname || '',
    name: player.name || player.nickname || '',
    photo: graphicsUtils.resolvePlayerPhoto(players.find((reg) => normalizeSteamId(reg.steamId) === normalizeSteamId(steamId)), baseUrl, ''),
    teamId: players.find((reg) => normalizeSteamId(reg.steamId) === normalizeSteamId(steamId))?.teamId || null,
    teamName: player.team || '',
    teamLogo: '',
    side: player.team || '',
    kills: toNumber(player.match_stats?.kills, 0),
    deaths: toNumber(player.match_stats?.deaths, 0),
    assists: toNumber(player.match_stats?.assists, 0),
    damage: toNumber(player.accumulatedDmg, 0),
    roundsPlayed: getRoundCount(),
    headshots: player.match_stats?.headshots ?? null,
    multiKills: {
      oneKillRounds: toNumber(player.match_stats?.oneKillRounds, 0),
      twoKillRounds: toNumber(player.match_stats?.twoKillRounds, 0),
      threeKillRounds: toNumber(player.match_stats?.threeKillRounds, 0),
      fourKillRounds: toNumber(player.match_stats?.fourKillRounds, 0),
      fiveKillRounds: toNumber(player.match_stats?.fiveKillRounds, 0),
      aces: toNumber(player.match_stats?.fiveKillRounds, 0),
      totalMultiKillRounds: toNumber(player.match_stats?.oneKillRounds, 0) + toNumber(player.match_stats?.twoKillRounds, 0) + toNumber(player.match_stats?.threeKillRounds, 0) + toNumber(player.match_stats?.fourKillRounds, 0) + toNumber(player.match_stats?.fiveKillRounds, 0)
    },
    opening: {
      firstKills: player.match_stats?.firstKills ?? null,
      firstDeaths: player.match_stats?.firstDeaths ?? null,
      entryDiff: player.match_stats?.firstKills != null && player.match_stats?.firstDeaths != null ? toNumber(player.match_stats.firstKills, 0) - toNumber(player.match_stats.firstDeaths, 0) : null
    },
    utility: {
      flashesThrown: player.match_stats?.flashesThrown ?? null,
      enemiesFlashed: player.match_stats?.enemiesFlashed ?? null,
      flashAssists: player.match_stats?.flashAssists ?? null,
      smokesThrown: player.match_stats?.smokesThrown ?? null,
      heThrown: player.match_stats?.heThrown ?? null,
      molotovsThrown: player.match_stats?.molotovsThrown ?? null,
      decoysThrown: player.match_stats?.decoysThrown ?? null,
      utilityDamage: player.match_stats?.utilityDamage ?? null
    },
    economy: {
      money: player.state?.money ?? null,
      equipmentValue: player.state?.equipment_value ?? null,
      spendThisRound: player.state?.spend_this_round ?? null
    },
    sideStats: {
      CT: {
        rounds: toNumber(player.match_stats?.ct_rounds, 0),
        kills: toNumber(player.match_stats?.ct_kills, 0),
        deaths: toNumber(player.match_stats?.ct_deaths, 0),
        adr: toNumber(player.match_stats?.ct_rounds, 0) > 0 ? parseFloat((toNumber(player.match_stats?.ct_damage, 0) / toNumber(player.match_stats?.ct_rounds, 0)).toFixed(1)) : 0
      },
      T: {
        rounds: toNumber(player.match_stats?.t_rounds, 0),
        kills: toNumber(player.match_stats?.t_kills, 0),
        deaths: toNumber(player.match_stats?.t_deaths, 0),
        adr: toNumber(player.match_stats?.t_rounds, 0) > 0 ? parseFloat((toNumber(player.match_stats?.t_damage, 0) / toNumber(player.match_stats?.t_rounds, 0)).toFixed(1)) : 0
      }
    },
    rating: calcGalaxyRating({
      kills: toNumber(player.match_stats?.kills, 0),
      deaths: toNumber(player.match_stats?.deaths, 0),
      assists: toNumber(player.match_stats?.assists, 0),
      damage: toNumber(player.accumulatedDmg, 0),
      kastRounds: toNumber(player.match_stats?.kastRounds, 0),
      rounds: getRoundCount()
    }),
    customRating: calcGalaxyRating({
      kills: toNumber(player.match_stats?.kills, 0),
      deaths: toNumber(player.match_stats?.deaths, 0),
      assists: toNumber(player.match_stats?.assists, 0),
      damage: toNumber(player.accumulatedDmg, 0),
      kastRounds: toNumber(player.match_stats?.kastRounds, 0),
      rounds: getRoundCount()
    }),
    isPlaceholder: false
  }));

  const liveMatchPlayers = Object.entries(scoreboard.players || {}).length > 0
    ? liveFromScoreboard
    : Object.entries(currentMatch?.players || {}).map(([steamId, player]) => {
        const regPlayer = players.find((reg) => normalizeSteamId(reg.steamId) === normalizeSteamId(steamId));
        return buildLivePlayerStatsSnapshot(steamId, player, currentMatch, baseUrl) || buildPlayerStatsSnapshot(steamId, baseUrl);
      });

  const liveDataPlayers = Array.isArray(liveData.players) ? liveData.players : [];
  const postmatchPlayers = Array.isArray(postmatchData.players) ? postmatchData.players : [];

  if (mode === 'live') {
    if (liveMatchPlayers.length > 0) {
      liveMatchPlayers.forEach(addCandidate);
    }
    if (candidates.length === 0 && liveDataPlayers.length > 0) {
      liveDataPlayers.forEach((player) => addCandidate(player));
    }
    if (candidates.length === 0 && currentMatch && currentMatch.players) {
      Object.keys(currentMatch.players).forEach((steamId) => addCandidate(buildPlayerStatsSnapshot(steamId, baseUrl)));
    }
    if (candidates.length === 0) {
      const allKnownIds = [
        ...Object.keys(scoreboard.players || {}),
        ...Object.keys(liveData.players || {}),
        ...Object.keys(currentMatch?.players || {})
      ];
      buildKnownPlayersFromIds(allKnownIds);
    }
  } else {
    const isFinishedPostmatch = isFinishedMatch(postmatchData);
    const completedMatch = isFinishedPostmatch ? postmatchData : getLatestCompletedMatch();
    const sourcePlayers = Array.isArray(completedMatch?.players) ? completedMatch.players : postmatchPlayers;
    if (sourcePlayers.length > 0) {
      sourcePlayers.forEach((player) => addCandidate(player));
    }
    if (candidates.length === 0 && completedMatch && completedMatch.players) {
      Object.keys(completedMatch.players).forEach((steamId) => addCandidate(buildPlayerStatsSnapshot(steamId, baseUrl)));
    }
    if (candidates.length === 0) {
      const allKnownIds = [
        ...Object.keys(scoreboard.players || {}),
        ...Object.keys(liveData.players || {}),
        ...Object.keys(postmatchData.players || {})
      ];
      buildKnownPlayersFromIds(allKnownIds);
    }
  }

  const meaningfulPlayers = sortPlayersBestToWorst(candidates.filter((player) => !player.isPlaceholder));

  const topSelector = (selector) => meaningfulPlayers
    .slice()
    .sort((a, b) => {
      const aValue = selector(a);
      const bValue = selector(b);
      if (bValue !== aValue) return bValue - aValue;
      return toNumber(a.deaths, 0) - toNumber(b.deaths, 0);
    })
    .slice(0, 5)
    .map((player) => normalizeTopPlayerEntry({
      id: player.id,
      name: player.name,
      nickname: player.nickname,
      photo: player.photo,
      teamId: player.teamId,
      teamLogo: player.teamLogo,
      value: selector(player)
    }));

  const topPlayers = buildStableTopPlayers({
    kills: topSelector((player) => toNumber(player.kills, 0)),
    adr: topSelector((player) => toNumber(player.adr, 0)),
    damage: topSelector((player) => toNumber(player.damage, 0)),
    kd: topSelector((player) => toNumber(player.kd, 0)),
    plusMinus: topSelector((player) => toNumber(player.plusMinus, 0)),
    rating: topSelector((player) => toNumber(player.rating || player.customRating, 0)),
    aces: topSelector((player) => toNumber(player.multiKills?.aces, 0)),
    multiKills: topSelector((player) => toNumber(player.multiKills?.totalMultiKillRounds, 0)),
    flashAssists: topSelector((player) => toNumber(player.utility?.flashAssists, 0)),
    enemiesFlashed: topSelector((player) => toNumber(player.utility?.enemiesFlashed, 0))
  });

  const mvp = buildStableMvp(meaningfulPlayers[0] || null);

  const teamALiveValue = liveData.teamA || scoreboard.map?.team_ct?.name || currentMatch?.teamCT?.name || currentMatch?.teamA || null;
  const teamBLiveValue = liveData.teamB || scoreboard.map?.team_t?.name || currentMatch?.teamT?.name || currentMatch?.teamB || null;
  const teamAPostValue = postmatchData.teamA || getLatestCompletedMatch()?.teamA || null;
  const teamBPostValue = postmatchData.teamB || getLatestCompletedMatch()?.teamB || null;

  const teamAValue = mode === 'live' ? teamALiveValue : teamAPostValue;
  const teamBValue = mode === 'live' ? teamBLiveValue : teamBPostValue;
  const teamAName = extractTeamNameValue(teamAValue);
  const teamBName = extractTeamNameValue(teamBValue);
  const teamAId = extractTeamIdValue(teamAValue);
  const teamBId = extractTeamIdValue(teamBValue);

  const rankedTeamAPlayers = sortPlayersBestToWorst(
    meaningfulPlayers.filter((player) =>
      isPlayerInTeam(player, { teamId: teamAId, teamName: teamAName, side: 'CT' })
    )
  );
  const rankedTeamBPlayers = sortPlayersBestToWorst(
    meaningfulPlayers.filter((player) =>
      isPlayerInTeam(player, { teamId: teamBId, teamName: teamBName, side: 'T' })
    )
  );

  const fallbackTeamAPlayers = sortPlayersBestToWorst(
    meaningfulPlayers.filter((player) => (player.side || '').toUpperCase() === 'CT')
  );
  const fallbackTeamBPlayers = sortPlayersBestToWorst(
    meaningfulPlayers.filter((player) => (player.side || '').toUpperCase() === 'T')
  );

  const teamAPlayersRaw = (rankedTeamAPlayers.length ? rankedTeamAPlayers : fallbackTeamAPlayers).slice(0, teamSlots);
  const teamBPlayersRaw = (rankedTeamBPlayers.length ? rankedTeamBPlayers : fallbackTeamBPlayers).slice(0, teamSlots);

  const players = buildStablePlayerList(meaningfulPlayers, totalPlayerSlots);
  const teamAPlayers = buildTeamSlotList(teamAPlayersRaw, teamSlots);
  const teamBPlayers = buildTeamSlotList(teamBPlayersRaw, teamSlots);

  const payload = {
    mode,
    status: mode === 'live'
      ? (meaningfulPlayers.length > 0 ? 'live' : 'idle')
      : (isFinishedMatch(postmatchData) || getLatestCompletedMatch() ? 'finished' : 'idle'),
    matchId: mode === 'live'
      ? (scoreboard.matchId || liveData.matchId || currentMatch?.mapName || null)
      : (postmatchData.matchId || getLatestCompletedMatch()?.matchId || getLatestCompletedMatch()?.id || null),
    map: mode === 'live'
      ? (scoreboard.map?.name || liveData.map || currentMatch?.mapName || null)
      : (postmatchData.map || getLatestCompletedMatch()?.map || null),
    round: mode === 'live'
      ? (scoreboard.map?.round || currentMatch?.roundCount || liveData.round || 0)
      : (postmatchData.round || getLatestCompletedMatch()?.round || 0),
    updatedAt: mode === 'live'
      ? (liveData.updatedAt || currentMatch?.startedAt || lastScoreboardUpdate || new Date().toISOString())
      : (postmatchData.updatedAt || getLatestCompletedMatch()?.updatedAt || new Date().toISOString()),
    players,
    teamAPlayers,
    teamBPlayers,
    topPlayers,
    mvp,
    teamA: teamAValue,
    teamB: teamBValue,
    teamStats: mode === 'postmatch'
      ? (postmatchData.teamStats || getLatestCompletedMatch()?.teamStats || { teamA: null, teamB: null })
      : (liveData.teamStats || { teamA: null, teamB: null })
  };

  return isCompact ? buildCompactPlayerStatsPayload(payload) : payload;
}

function buildPlayerStatsPayloadFromMatch(match, req) {
  const baseUrl = getBaseUrl(req);
  if (!match || typeof match !== 'object') return null;

  const teamA = match.teamA || null;
  const teamB = match.teamB || null;
  const playersOut = Array.isArray(match.players)
    ? match.players.map((player) => {
        const reg = players.find((p) => normalizeSteamId(p.steamId) === normalizeSteamId(player.steamId));
        const team = reg?.teamId ? teams.find((t) => t.id === reg.teamId) : null;
        return {
          ...DEFAULT_PLAYER_STATS,
          ...player,
          id: player.id || reg?.id || `temp_${player.steamId || player.name}`,
          steamId: player.steamId || reg?.steamId || null,
          nickname: player.nickname || player.name || reg?.name || 'Unknown',
          name: player.name || player.nickname || reg?.name || 'Unknown',
          firstName: player.firstName ?? getPlayerFirstName(reg),
          lastName: player.lastName ?? getPlayerLastName(reg),
          fullName: player.fullName || buildPlayerFullName(player) || buildPlayerFullName(reg),
          country: player.country ?? reg?.country ?? null,
          countryCode: player.countryCode ?? getPlayerCountryCode(reg),
          role: player.role || reg?.role || '',
          photo: player.photo || graphicsUtils.resolvePlayerPhoto(reg, baseUrl),
          teamId: player.teamId || reg?.teamId || null,
          teamName: player.teamName || team?.name || null,
          teamLogo: player.teamLogo || (team ? graphicsUtils.resolveLogo(team, baseUrl) : `${baseUrl}/logos/none-team.png`),
          side: player.side || null,
          kills: toNumber(player.kills, 0),
          deaths: toNumber(player.deaths, 0),
          assists: toNumber(player.assists, 0),
          kd: player.kd != null ? toNumber(player.kd, 0) : (toNumber(player.deaths, 0) > 0 ? parseFloat((toNumber(player.kills, 0) / toNumber(player.deaths, 0)).toFixed(2)) : toNumber(player.kills, 0)),
          plusMinus: player.plusMinus != null ? toNumber(player.plusMinus, 0) : toNumber(player.kills, 0) - toNumber(player.deaths, 0),
          damage: toNumber(player.damage, 0),
          adr: player.adr != null ? toNumber(player.adr, 0) : 0,
          damagePerKill: player.damagePerKill != null ? toNumber(player.damagePerKill, 0) : null,
          roundsPlayed: toNumber(player.roundsPlayed ?? player.rounds, 0),
          headshots: player.headshots ?? null,
          headshotRate: player.headshotRate ?? null,
          multiKills: {
            oneKillRounds: player.multiKills?.oneKillRounds ?? null,
            twoKillRounds: player.multiKills?.twoKillRounds ?? null,
            threeKillRounds: player.multiKills?.threeKillRounds ?? null,
            fourKillRounds: player.multiKills?.fourKillRounds ?? null,
            fiveKillRounds: player.multiKills?.fiveKillRounds ?? null,
            aces: player.multiKills?.aces ?? null,
            totalMultiKillRounds: player.multiKills?.totalMultiKillRounds ?? null
          },
          opening: {
            firstKills: player.opening?.firstKills ?? null,
            firstDeaths: player.opening?.firstDeaths ?? null,
            entryDiff: player.opening?.entryDiff ?? null
          },
          clutches: {
            attempts: player.clutches?.attempts ?? null,
            wins: player.clutches?.wins ?? null,
            oneVsOne: player.clutches?.oneVsOne ?? null,
            oneVsTwo: player.clutches?.oneVsTwo ?? null,
            oneVsThree: player.clutches?.oneVsThree ?? null,
            oneVsFour: player.clutches?.oneVsFour ?? null,
            oneVsFive: player.clutches?.oneVsFive ?? null
          },
          utility: {
            flashesThrown: player.utility?.flashesThrown ?? null,
            enemiesFlashed: player.utility?.enemiesFlashed ?? null,
            flashAssists: player.utility?.flashAssists ?? null,
            smokesThrown: player.utility?.smokesThrown ?? null,
            heThrown: player.utility?.heThrown ?? null,
            molotovsThrown: player.utility?.molotovsThrown ?? null,
            decoysThrown: player.utility?.decoysThrown ?? null,
            utilityDamage: player.utility?.utilityDamage ?? null
          },
          economy: {
            money: player.economy?.money ?? null,
            equipmentValue: player.economy?.equipmentValue ?? null,
            spendThisRound: player.economy?.spendThisRound ?? null
          },
          weaponStats: player.weaponStats || {},
          sideStats: player.sideStats || DEFAULT_PLAYER_STATS.sideStats,
          rating: player.rating ?? player.customRating ?? 0,
          customRating: player.customRating ?? player.rating ?? 0
        };
      })
    : [];

  const rankedPlayers = sortPlayersBestToWorst(playersOut);

  const topSelector = (selector) => [...rankedPlayers].sort((a, b) => {
    const bv = selector(b);
    const av = selector(a);
    if (bv !== av) return bv - av;
    return (a.deaths || 0) - (b.deaths || 0);
  }).slice(0, 5).map((p) => ({
    id: p.id,
    name: p.name,
    nickname: p.nickname,
    photo: p.photo,
    teamId: p.teamId,
    teamLogo: p.teamLogo,
    value: selector(p)
  }));

  const topPlayers = {
    kills: topSelector((p) => p.kills || 0),
    adr: topSelector((p) => p.adr || 0),
    damage: topSelector((p) => p.damage || 0),
    kd: topSelector((p) => p.kd || 0),
    plusMinus: topSelector((p) => p.plusMinus || 0),
    rating: topSelector((p) => p.rating || p.customRating || 0),
    aces: topSelector((p) => p.multiKills?.aces || 0),
    multiKills: topSelector((p) => p.multiKills?.totalMultiKillRounds || 0),
    flashAssists: topSelector((p) => p.utility?.flashAssists || 0),
    enemiesFlashed: topSelector((p) => p.utility?.enemiesFlashed || 0)
  };

  const mvp = rankedPlayers[0] || null;

  const teamAName = extractTeamNameValue(teamA);
  const teamBName = extractTeamNameValue(teamB);
  const teamAId = extractTeamIdValue(teamA);
  const teamBId = extractTeamIdValue(teamB);

  const rankedTeamAPlayers = sortPlayersBestToWorst(
    rankedPlayers.filter((player) => isPlayerInTeam(player, { teamId: teamAId, teamName: teamAName, side: 'CT' }))
  );
  const rankedTeamBPlayers = sortPlayersBestToWorst(
    rankedPlayers.filter((player) => isPlayerInTeam(player, { teamId: teamBId, teamName: teamBName, side: 'T' }))
  );

  const fallbackTeamA = sortPlayersBestToWorst(rankedPlayers.filter((player) => (player.side || '').toUpperCase() === 'CT'));
  const fallbackTeamB = sortPlayersBestToWorst(rankedPlayers.filter((player) => (player.side || '').toUpperCase() === 'T'));

  return {
    mode: 'postmatch',
    status: match.status || 'finished',
    matchId: match.matchId || match.id || null,
    map: match.map || match.mapName || null,
    round: match.round || match.roundCount || 0,
    updatedAt: match.updatedAt || match.finishedAt || new Date().toISOString(),
    players: buildStablePlayerList(rankedPlayers, 10),
    topPlayers,
    mvp,
    teamA: match.teamA || null,
    teamB: match.teamB || null,
    teamAPlayers: buildTeamSlotList(rankedTeamAPlayers.length ? rankedTeamAPlayers : fallbackTeamA, 5),
    teamBPlayers: buildTeamSlotList(rankedTeamBPlayers.length ? rankedTeamBPlayers : fallbackTeamB, 5),
    teamStats: match.teamStats || { teamA: null, teamB: null },
    roundHistory: Array.isArray(match.roundHistory) ? match.roundHistory : []
  };
}

let lastScoreboardUpdate = null;

function getIdlePostmatch() {
  return {
    mode: 'postmatch',
    status: 'idle',
    matchId: null,
    teamA: null,
    teamB: null,
    players: [],
    teamAPlayers: [],
    teamBPlayers: [],
    topPlayers: {
      kills: [],
      adr: [],
      damage: [],
      kd: [],
      plusMinus: [],
      rating: [],
      survivalRate: [],
      multiKills: []
    },
    mvp: null,
    teamStats: {
      teamA: null,
      teamB: null
    },
    roundHistory: [],
    updatedAt: null
  };
}

function getIdleLiveMatch() {
  return {
    mode: 'live',
    status: 'idle',
    matchId: null,
    map: null,
    round: 0,
    phase: 'idle',
    teamA: null,
    teamB: null,
    players: [],
    teams: {
      teamAPlayers: [],
      teamBPlayers: [],
      ctPlayers: [],
      tPlayers: []
    },
    topPlayers: {
      kills: [],
      adr: [],
      damage: []
    },
    updatedAt: null
  };
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function isTestLikeValue(value) {
  if (!value || typeof value !== 'string') return false;
  return /(test|mock|demo|e2e)/i.test(value);
}

function isTestLikeMatch(match) {
  if (!match || typeof match !== 'object') return false;
  if (match.test === true || match.mock === true) return true;

  const candidates = [
    match.matchId,
    match.id,
    match.name,
    match.teamA?.name,
    match.teamB?.name,
    match.map
  ];

  return candidates.some((val) => isTestLikeValue(val));
}

// -ï¿½-ï¿½-+-+-ï¿½-ï¿½ -ï¿½-+-ï¿½ -ï¿½-ï¿½-+-+-+-ï¿½-+ Gï¿½ï¿½ -ï¿½-+-+-ï¿½-+-ï¿½-ï¿½ -+ -+-ï¿½-ï¿½-+-ï¿½-+ (persistent storage)
let teams = [];      // -P-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½: { id, name, logo, score }
let players = [];  // -P-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½: { id, name, steamId, photo, teamId, match_stats }

// -P-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ scoreboard -ï¿½-+-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ GSI (-+-ï¿½ CS:GO/CS2)
let scoreboard = {
  players: {},
  map: {},
  player: {}
};

// -ï¿½-+-+-ï¿½-ï¿½-+-ï¿½-+-ï¿½-ï¿½ -+-ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½-ï¿½ -ï¿½-+-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½ -+-ï¿½-ï¿½-+-ï¿½-+-+ -ï¿½-ï¿½-ï¿½-+-ï¿½-+-ï¿½
let roundsHistory = [];
let roundsAlive = [];

// ?????? ???????? ????? (?? ?????? ??????, ?????????? ?? ??????), ????? ?????????? ??????? ??? ????? ??????? ?? ??? ?? ?????
let currentMatchKey = null;

function buildMatchKey(mapObj) {
  if (!mapObj) return null;
  const ctName = (mapObj.team_ct?.name || 'CT').toLowerCase();
  const tName = (mapObj.team_t?.name || 'T').toLowerCase();
  // ?????????, ????? ?? ???????? ?? ?????? ????? ????? ???????
  return [ctName, tName].sort().join(' vs ');
}

let overallRoundTracker = {
  currentRound: 0,
  players: {}
};

function resetOverallRoundTracker() {
  overallRoundTracker = {
    currentRound: getRoundCount(),
    players: {}
  };
}

// â”€â”€â”€ GSI Kill Delta Tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tracks opening kills, weapon kills, headshots, and multi-kills via GSI deltas.
// Results stored in scoreboard.players[steamId]._tracked and consumed by
// buildScoreboardOverallPlayer.
let gsiKillTracker = {};
let killTrackCurrentRound  = 0;
let killTrackRoundOpeningDone = false;
let killTrackRoundFirstDeathDone = false;
let clutchTrackerState = {
  currentRound: 0,
  roundAttempts: {},
  pendingRounds: {},
  previousScore: { CT: 0, T: 0 },
  unresolvedWarnings: []
};

function resetGsiKillTracker() {
  gsiKillTracker = {};
  killTrackCurrentRound = toNumber(getRoundCount(), 0);
  killTrackRoundOpeningDone = false;
  killTrackRoundFirstDeathDone = false;
  clutchTrackerState = {
    currentRound: toNumber(getRoundCount(), 0),
    roundAttempts: {},
    pendingRounds: {},
    previousScore: {
      CT: toNumber(scoreboard.map?.team_ct?.score, 0),
      T: toNumber(scoreboard.map?.team_t?.score, 0)
    },
    unresolvedWarnings: []
  };
}

function getAlivePlayersBySide() {
  const aliveCT = [];
  const aliveT = [];
  for (const steamId in scoreboard.players || {}) {
    const player = scoreboard.players[steamId];
    if (!player || (player.team !== 'CT' && player.team !== 'T')) continue;
    const hp = toNumber(player?.state?.health, 0);
    if (hp > 0) {
      if (player.team === 'CT') aliveCT.push(steamId);
      if (player.team === 'T') aliveT.push(steamId);
    }
  }
  return { aliveCT, aliveT };
}

function getRoundWinnerSide(roundNumber) {
  const roundWins = scoreboard.map?.round_wins;
  const key = String(roundNumber);
  const value = roundWins && typeof roundWins === 'object' ? roundWins[key] : null;
  if (typeof value === 'string') {
    const token = value.toLowerCase();
    if (token.includes('ct_win')) return 'CT';
    if (token.includes('t_win')) return 'T';
  }

  const currentCtScore = toNumber(scoreboard.map?.team_ct?.score, 0);
  const currentTScore = toNumber(scoreboard.map?.team_t?.score, 0);
  const prevCtScore = toNumber(clutchTrackerState.previousScore?.CT, 0);
  const prevTScore = toNumber(clutchTrackerState.previousScore?.T, 0);
  if (currentCtScore > prevCtScore) return 'CT';
  if (currentTScore > prevTScore) return 'T';
  return null;
}

function finalizePendingClutchRound(roundNumber, winnerSide) {
  const pending = clutchTrackerState.pendingRounds?.[roundNumber];
  if (!pending) return;

  const trackerPlayer = ensureKillTrackerPlayer(pending.steamId);
  if (!winnerSide || (winnerSide !== 'CT' && winnerSide !== 'T')) {
    const warning = `clutch_winner_unknown_round_${roundNumber}`;
    if (!clutchTrackerState.unresolvedWarnings.includes(warning)) {
      clutchTrackerState.unresolvedWarnings.push(warning);
    }
    return;
  }

  const size = Math.max(1, Math.min(5, toNumber(pending.clutchSize, 0)));
  const sizeNames = {
    1: 'One',
    2: 'Two',
    3: 'Three',
    4: 'Four',
    5: 'Five'
  };
  const suffix = sizeNames[size];

  if (pending.teamSide === winnerSide) {
    trackerPlayer.matchStats.clutches_wins += 1;
    trackerPlayer.matchStats[`clutches_1v${size}_wins`] += 1;
    trackerPlayer.matchStats[`clutches_oneVs${suffix}Wins`] += 1;
  } else {
    trackerPlayer.matchStats.clutches_losses += 1;
    trackerPlayer.matchStats[`clutches_1v${size}_losses`] += 1;
    trackerPlayer.matchStats[`clutches_oneVs${suffix}Losses`] += 1;
  }

  const warning = `clutch_winner_unknown_round_${roundNumber}`;
  clutchTrackerState.unresolvedWarnings = (clutchTrackerState.unresolvedWarnings || []).filter((entry) => entry !== warning);
  delete clutchTrackerState.pendingRounds[roundNumber];
}

function ensureKillTrackerPlayer(steamId) {
  if (!gsiKillTracker[steamId]) {
    gsiKillTracker[steamId] = {
      previousKills: 0,
      previousDeaths: 0,
      previousAssists: 0,
      previousRoundKills: 0,
      previousRoundHs: 0,
      previousRoundDamage: null,
      currentRoundDamage: 0,
      currentRoundDamageMax: 0,
      lastActiveWeapon: null,
      hasRoundKillHsField: false,
      hasRoundKillsField: false,
      hasRoundTotalDmgField: false,
      weaponTrackingAvailable: false,
      weaponUnknownKills: 0,
      trackerWarnings: [],
      roundStats: {
        killsByRound: [],
        damageByRound: []
      },
      matchStats: {
        firstKills: 0,
        firstDeaths: 0,
        headshots: 0,
        damageTotal: 0,
        awpKills: 0, rifleKills: 0, pistolKills: 0,
        knifeKills: 0, zeusKills: 0, smgKills: 0,
        multiKills_1k: 0, multiKills_2k: 0, multiKills_3k: 0,
        multiKills_4k: 0, multiKills_5k: 0,
        clutches_attempts: 0,
        clutches_wins: 0,
        clutches_losses: 0,
        clutches_1v1_attempts: 0,
        clutches_1v1_wins: 0,
        clutches_1v1_losses: 0,
        clutches_1v2_attempts: 0,
        clutches_1v2_wins: 0,
        clutches_1v2_losses: 0,
        clutches_1v3_attempts: 0,
        clutches_1v3_wins: 0,
        clutches_1v3_losses: 0,
        clutches_1v4_attempts: 0,
        clutches_1v4_wins: 0,
        clutches_1v4_losses: 0,
        clutches_1v5_attempts: 0,
        clutches_1v5_wins: 0,
        clutches_1v5_losses: 0,
        clutches_oneVsOne: 0,
        clutches_oneVsTwo: 0,
        clutches_oneVsThree: 0,
        clutches_oneVsFour: 0,
        clutches_oneVsFive: 0,
        clutches_oneVsOneWins: 0,
        clutches_oneVsTwoWins: 0,
        clutches_oneVsThreeWins: 0,
        clutches_oneVsFourWins: 0,
        clutches_oneVsFiveWins: 0,
        clutches_oneVsOneLosses: 0,
        clutches_oneVsTwoLosses: 0,
        clutches_oneVsThreeLosses: 0,
        clutches_oneVsFourLosses: 0,
        clutches_oneVsFiveLosses: 0
      }
    };
  }
  return gsiKillTracker[steamId];
}

function resolveActiveWeapon(weapons, fallbackWeapon = null) {
  if (weapons && typeof weapons === 'object') {
    for (const slot of Object.keys(weapons)) {
      const weapon = weapons[slot];
      if (weapon && typeof weapon === 'object' && weapon.state === 'active') {
        return {
          name: (weapon.name || '').toLowerCase(),
          type: (weapon.type || '').toLowerCase()
        };
      }
    }
  }
  return fallbackWeapon || null;
}

function classifyWeaponKillCounter(activeWeapon) {
  if (!activeWeapon || typeof activeWeapon !== 'object') return null;
  const name = (activeWeapon.name || '').toLowerCase();
  const type = (activeWeapon.type || '').toLowerCase();
  if (!name && !type) return null;
  if (name === 'weapon_awp') return 'awpKills';
  if (name.includes('taser') || name.includes('zeus')) return 'zeusKills';
  if (type === 'rifle') return 'rifleKills';
  if (type === 'pistol') return 'pistolKills';
  if (type === 'knife') return 'knifeKills';
  if (type === 'submachine gun' || type === 'smg') return 'smgKills';
  return null;
}

function processGsiKillTracking() {
  const currentRound  = toNumber(getRoundCount(), 0);
  const roundAdvanced = currentRound > killTrackCurrentRound && killTrackCurrentRound > 0;

  if (roundAdvanced) {
    const finishedRound = Math.max(0, currentRound - 1);
    const pendingRounds = Object.keys(clutchTrackerState.pendingRounds || {})
      .map((value) => toNumber(value, 0))
      .filter((value) => value > 0 && value <= finishedRound)
      .sort((a, b) => a - b);
    pendingRounds.forEach((roundNo) => {
      const winnerSide = getRoundWinnerSide(roundNo);
      finalizePendingClutchRound(roundNo, winnerSide);
    });

    // Round just ended: persist per-round stats and multi-kill bucket.
    for (const steamId in scoreboard.players || {}) {
      const pd = scoreboard.players[steamId];
      if (!pd || (pd.team !== 'CT' && pd.team !== 'T')) continue;
      const tr = ensureKillTrackerPlayer(steamId);

      const rk = Math.max(toNumber(pd?.state?.round_kills, 0), tr.previousRoundKills);
      if (rk >= 1) tr.matchStats['multiKills_' + Math.min(rk, 5) + 'k'] += 1;

      tr.roundStats.killsByRound.push(rk);
      tr.roundStats.damageByRound.push(toNumber(tr.currentRoundDamageMax, 0));
      tr.previousRoundDamage = toNumber(tr.currentRoundDamageMax, 0);

      tr.previousRoundKills = 0;
      tr.previousRoundHs = 0;
      tr.currentRoundDamage = 0;
      tr.currentRoundDamageMax = 0;
    }

    killTrackRoundOpeningDone = false;
    killTrackRoundFirstDeathDone = false;
    killTrackCurrentRound     = currentRound;
  } else if (killTrackCurrentRound === 0) {
    killTrackCurrentRound = currentRound;
  }

  const { aliveCT, aliveT } = getAlivePlayersBySide();
  const hasAttemptThisRound = !!clutchTrackerState.roundAttempts[currentRound];
  if (!hasAttemptThisRound) {
    let clutchSteamId = null;
    let clutchSide = null;
    let clutchSize = null;

    if (aliveCT.length === 1 && aliveT.length >= 1 && aliveT.length <= 5) {
      clutchSteamId = aliveCT[0];
      clutchSide = 'CT';
      clutchSize = aliveT.length;
    } else if (aliveT.length === 1 && aliveCT.length >= 1 && aliveCT.length <= 5) {
      clutchSteamId = aliveT[0];
      clutchSide = 'T';
      clutchSize = aliveCT.length;
    }

    if (clutchSteamId && clutchSize != null) {
      const trackerPlayer = ensureKillTrackerPlayer(clutchSteamId);
      const size = Math.max(1, Math.min(5, toNumber(clutchSize, 0)));
      const sizeNames = {
        1: 'One',
        2: 'Two',
        3: 'Three',
        4: 'Four',
        5: 'Five'
      };
      const suffix = sizeNames[size];

      trackerPlayer.matchStats.clutches_attempts += 1;
      trackerPlayer.matchStats[`clutches_1v${size}_attempts`] += 1;
      trackerPlayer.matchStats[`clutches_oneVs${suffix}`] += 1;

      clutchTrackerState.roundAttempts[currentRound] = {
        steamId: clutchSteamId,
        teamSide: clutchSide,
        clutchSize: size,
        recordedAt: Date.now()
      };
      clutchTrackerState.pendingRounds[currentRound] = {
        steamId: clutchSteamId,
        teamSide: clutchSide,
        clutchSize: size,
        status: 'pending'
      };
    }
  }

  const deltas = [];
  for (const steamId in scoreboard.players || {}) {
    const pd = scoreboard.players[steamId];
    if (!pd || (pd.team !== 'CT' && pd.team !== 'T')) continue;
    const tr = ensureKillTrackerPlayer(steamId);

    const payloadSteamId = pd?.steamid || pd?.steamId || null;
    if (payloadSteamId && normalizeSteamId(payloadSteamId) !== normalizeSteamId(steamId)) {
      const warning = `steamid_key_mismatch:${steamId}:${payloadSteamId}`;
      if (!tr.trackerWarnings.includes(warning)) tr.trackerWarnings.push(warning);
    }

    const curKills = toNumber(pd?.match_stats?.kills, 0);
    const curDeaths = toNumber(pd?.match_stats?.deaths, 0);
    const curAssists = toNumber(pd?.match_stats?.assists, 0);

    const killDelta = Math.max(0, curKills - toNumber(tr.previousKills, 0));
    const deathDelta = Math.max(0, curDeaths - toNumber(tr.previousDeaths, 0));
    const assistDelta = Math.max(0, curAssists - toNumber(tr.previousAssists, 0));

    deltas.push({
      steamId,
      killDelta,
      deathDelta,
      assistDelta
    });
  }

  if (!killTrackRoundOpeningDone) {
    const killerEntry = deltas
      .filter((entry) => entry.killDelta > 0)
      .sort((a, b) => b.killDelta - a.killDelta)[0] || null;
    if (killerEntry) {
      const killerTracker = ensureKillTrackerPlayer(killerEntry.steamId);
      killerTracker.matchStats.firstKills += 1;
      killTrackRoundOpeningDone = true;
    }
  }

  if (!killTrackRoundFirstDeathDone) {
    const victimEntry = deltas
      .filter((entry) => entry.deathDelta > 0)
      .sort((a, b) => b.deathDelta - a.deathDelta)[0] || null;
    if (victimEntry) {
      const victimTracker = ensureKillTrackerPlayer(victimEntry.steamId);
      victimTracker.matchStats.firstDeaths += 1;
      killTrackRoundFirstDeathDone = true;
    }
  }

  // Per-player intra-round delta tracking
  for (const steamId in scoreboard.players || {}) {
    const pd = scoreboard.players[steamId];
    if (!pd || (pd.team !== 'CT' && pd.team !== 'T')) continue;
    const tr = ensureKillTrackerPlayer(steamId);

    const curKills  = toNumber(pd?.match_stats?.kills, 0);
    const curDeaths = toNumber(pd?.match_stats?.deaths, 0);
    const curAssists = toNumber(pd?.match_stats?.assists, 0);
    const curHs     = toNumber(pd?.state?.round_killhs, 0);
    const curRndK   = toNumber(pd?.state?.round_kills,  0);
    const curRoundDamage = toNumber(pd?.state?.round_totaldmg, tr.currentRoundDamage);
    const killDelta = Math.max(0, curKills - toNumber(tr.previousKills, 0));

    if (pd?.state && Object.prototype.hasOwnProperty.call(pd.state, 'round_killhs')) {
      tr.hasRoundKillHsField = true;
    }
    if (pd?.state && Object.prototype.hasOwnProperty.call(pd.state, 'round_kills')) {
      tr.hasRoundKillsField = true;
    }
    if (pd?.state && Object.prototype.hasOwnProperty.call(pd.state, 'round_totaldmg')) {
      tr.hasRoundTotalDmgField = true;
    }

    const activeWeapon = resolveActiveWeapon(pd?.weapons, tr.lastActiveWeapon);
    if (activeWeapon) {
      tr.lastActiveWeapon = activeWeapon;
      tr.weaponTrackingAvailable = true;
    }

    if (killDelta > 0) {
      // Weapon kill â€” categorize by active weapon snapshot at kill delta moment
      const weaponBucket = classifyWeaponKillCounter(activeWeapon);
      if (killDelta === 1) {
        if (weaponBucket) {
          tr.matchStats[weaponBucket] += 1;
        } else {
          tr.weaponUnknownKills += 1;
        }
      } else {
        // Snapshot jumped by >1 kill: weapon attribution is ambiguous, keep as unknown.
        tr.weaponUnknownKills += killDelta;
        const warning = `weapon_delta_gt1:${steamId}:delta=${killDelta}`;
        if (!tr.trackerWarnings.includes(warning)) tr.trackerWarnings.push(warning);
      }
    }

    tr.previousKills = curKills;
    tr.previousDeaths = curDeaths;
    tr.previousAssists = curAssists;

    if (curRoundDamage < tr.currentRoundDamage) {
      tr.currentRoundDamage = curRoundDamage;
      tr.currentRoundDamageMax = Math.max(tr.currentRoundDamageMax, curRoundDamage);
    } else {
      tr.currentRoundDamage = curRoundDamage;
      tr.currentRoundDamageMax = Math.max(tr.currentRoundDamageMax, curRoundDamage);
    }
    tr.matchStats.damageTotal = toNumber(pd?.accumulatedDmg, tr.matchStats.damageTotal);

    // Headshot delta: round_killhs increases within a round
    if (curHs > tr.previousRoundHs) {
      tr.matchStats.headshots += curHs - tr.previousRoundHs;
      tr.previousRoundHs = curHs;
    }

    // Track max round_kills seen (for multi-kill recording at round end)
    if (curRndK > tr.previousRoundKills) tr.previousRoundKills = curRndK;

    // Write tracked stats to player object for buildScoreboardOverallPlayer
    scoreboard.players[steamId]._tracked = {
      ...tr.matchStats,
      previousKills: tr.previousKills,
      previousDeaths: tr.previousDeaths,
      previousAssists: tr.previousAssists,
      previousRoundKills: tr.previousRoundKills,
      previousRoundHs: tr.previousRoundHs,
      previousRoundDamage: tr.previousRoundDamage,
      damageCurrentRound: tr.currentRoundDamage,
      lastActiveWeapon: tr.lastActiveWeapon,
      roundStats: tr.roundStats,
      matchStats: tr.matchStats,
      hasRoundKillHsField: tr.hasRoundKillHsField,
      hasRoundKillsField: tr.hasRoundKillsField,
      hasRoundTotalDmgField: tr.hasRoundTotalDmgField,
      weaponTrackingAvailable: tr.weaponTrackingAvailable,
      weaponUnknownKills: tr.weaponUnknownKills,
      trackerWarnings: tr.trackerWarnings,
      clutchPendingRounds: Object.keys(clutchTrackerState.pendingRounds || {}).map((round) => toNumber(round, 0))
    };
  }

  clutchTrackerState.previousScore = {
    CT: toNumber(scoreboard.map?.team_ct?.score, 0),
    T: toNumber(scoreboard.map?.team_t?.score, 0)
  };
  clutchTrackerState.currentRound = currentRound;
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ensureOverallTrackerPlayer(steamId) {
  if (!overallRoundTracker.players[steamId]) {
    overallRoundTracker.players[steamId] = {
      roundStart: {
        kills: 0,
        damage: 0,
        survivedRounds: 0
      },
      lastTotals: {
        kills: 0,
        damage: 0,
        survivedRounds: 0
      },
      lastKnownHealth: null,
      roundStats: {
        killsByRound: [],
        damageByRound: [],
        survivedByRound: [],
        kastByRound: []
      }
    };
  }
  return overallRoundTracker.players[steamId];
}

function getSurvivedRoundsCumulative(playerData) {
  const value = playerData?.match_stats?.survived_rounds ?? playerData?.match_stats?.survivedRounds;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function updateOverallRoundTrackerFromScoreboard() {
  const currentRound = toNumber(getRoundCount(), 0);

  if (currentRound < overallRoundTracker.currentRound) {
    resetOverallRoundTracker();
    resetGsiKillTracker();
  }

  const roundAdvanced = currentRound > overallRoundTracker.currentRound;

  if (roundAdvanced) {
    for (const steamId in scoreboard.players || {}) {
      const playerData = scoreboard.players[steamId] || {};
      const tracked = ensureOverallTrackerPlayer(steamId);

      const currentKills = toNumber(playerData?.match_stats?.kills, tracked.lastTotals.kills);
      const currentDamage = toNumber(playerData?.accumulatedDmg, tracked.lastTotals.damage);
      const currentSurvivedRounds = getSurvivedRoundsCumulative(playerData);

      const killDelta = Math.max(0, currentKills - toNumber(tracked.roundStart.kills, 0));
      const damageDelta = Math.max(0, currentDamage - toNumber(tracked.roundStart.damage, 0));

      let survivedInRound = null;
      if (currentSurvivedRounds != null) {
        survivedInRound = currentSurvivedRounds > toNumber(tracked.roundStart.survivedRounds, 0);
      } else if (tracked.lastKnownHealth != null) {
        survivedInRound = toNumber(tracked.lastKnownHealth, 0) > 0;
      }

      tracked.roundStats.killsByRound.push(killDelta);
      tracked.roundStats.damageByRound.push(damageDelta);
      tracked.roundStats.survivedByRound.push(survivedInRound);
      tracked.roundStats.kastByRound.push(null);

      tracked.roundStart = {
        kills: currentKills,
        damage: currentDamage,
        survivedRounds: currentSurvivedRounds != null ? currentSurvivedRounds : toNumber(tracked.roundStart.survivedRounds, 0)
      };
      tracked.lastTotals = {
        kills: currentKills,
        damage: currentDamage,
        survivedRounds: currentSurvivedRounds != null ? currentSurvivedRounds : toNumber(tracked.lastTotals.survivedRounds, 0)
      };
    }

    overallRoundTracker.currentRound = currentRound;
  }

  for (const steamId in scoreboard.players || {}) {
    const playerData = scoreboard.players[steamId] || {};
    const tracked = ensureOverallTrackerPlayer(steamId);

    const currentKills = toNumber(playerData?.match_stats?.kills, tracked.lastTotals.kills);
    const currentDamage = toNumber(playerData?.accumulatedDmg, tracked.lastTotals.damage);
    const currentSurvivedRounds = getSurvivedRoundsCumulative(playerData);

    tracked.lastKnownHealth = playerData?.state?.health ?? tracked.lastKnownHealth;
    tracked.lastTotals = {
      kills: currentKills,
      damage: currentDamage,
      survivedRounds: currentSurvivedRounds != null ? currentSurvivedRounds : toNumber(tracked.lastTotals.survivedRounds, 0)
    };

    if (tracked.roundStart.kills === 0 && tracked.roundStart.damage === 0 && tracked.roundStats.killsByRound.length === 0) {
      tracked.roundStart = {
        kills: currentKills,
        damage: currentDamage,
        survivedRounds: currentSurvivedRounds != null ? currentSurvivedRounds : 0
      };
    }
  }
}

function getOverallRoundStatsForPlayer(steamId, roundsPlayed = 0) {
  const tracked = overallRoundTracker.players[steamId];
  const empty = { killsByRound: [], damageByRound: [], survivedByRound: [], kastByRound: [] };
  if (!tracked) return empty;

  const killsByRound = Array.isArray(tracked.roundStats.killsByRound) ? [...tracked.roundStats.killsByRound] : [];
  const damageByRound = Array.isArray(tracked.roundStats.damageByRound) ? [...tracked.roundStats.damageByRound] : [];
  const survivedByRound = Array.isArray(tracked.roundStats.survivedByRound) ? [...tracked.roundStats.survivedByRound] : [];
  const kastByRound = Array.isArray(tracked.roundStats.kastByRound) ? [...tracked.roundStats.kastByRound] : [];

  if (roundsPlayed > 0) {
    while (killsByRound.length < roundsPlayed) killsByRound.push(0);
    while (damageByRound.length < roundsPlayed) damageByRound.push(0);
    while (survivedByRound.length < roundsPlayed) survivedByRound.push(null);
    while (kastByRound.length < roundsPlayed) kastByRound.push(null);

    if (killsByRound.length > roundsPlayed) killsByRound.length = roundsPlayed;
    if (damageByRound.length > roundsPlayed) damageByRound.length = roundsPlayed;
    if (survivedByRound.length > roundsPlayed) survivedByRound.length = roundsPlayed;
    if (kastByRound.length > roundsPlayed) kastByRound.length = roundsPlayed;
  }

  return { killsByRound, damageByRound, survivedByRound, kastByRound };
}

// ------------------------------
// -ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-+ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ -+-+ data.json
// ------------------------------
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const jsonData = JSON.parse(raw);
      teams = jsonData.teams || [];
      players = jsonData.players || [];
      console.log("-ï¿½-ï¿½-+-+-ï¿½-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½ -+-+ data.json");
    } catch (err) {
      console.error("-P-ï¿½-+-ï¿½-ï¿½-ï¿½ -+-ï¿½-+ -ï¿½-ï¿½-ï¿½-+-+-+ data.json:", err);
      teams = [];
      players = [];
    }
  } else {
    console.log("-ï¿½-ï¿½-ï¿½-+ data.json -+-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-+, -+-ï¿½-ï¿½-+-+-ï¿½-ï¿½-+ -ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½");
  }
}

// -ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½ -ï¿½-+-ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ -ï¿½ data.json
function saveData() {
  const jsonData = { teams, players };
  fs.writeFileSync(DATA_FILE, JSON.stringify(jsonData, null, 2), 'utf8');
  console.log("-ï¿½-ï¿½-+-+-ï¿½-ï¿½ -ï¿½-+-ï¿½-ï¿½-ï¿½-+-ï¿½-+-ï¿½ -ï¿½ data.json");
}

// -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ -+-ï¿½-+ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½
loadData();

// ------------------------------
// -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½ Multer -ï¿½-+-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-+ -+-+-ï¿½-+-ï¿½-+-+-+-ï¿½ -ï¿½-+-+-ï¿½-+-ï¿½
// ------------------------------
const storageTeams = multer.diskStorage({
  destination: function (req, file, cb) {
    // ????? ??? ????????? ??????
    const dir = 'public/logos/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const uploadTeams = multer({ storage: storageTeams });

// ------------------------------
// -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½ Multer -ï¿½-+-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-+ -ï¿½-+-ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½ -+-ï¿½-ï¿½-+-ï¿½-+-ï¿½
// ------------------------------
const storagePlayers = multer.diskStorage({
  destination: function (req, file, cb) {
    // ????? ??? ???? ???????
    const dir = 'public/players/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const uploadPlayers = multer({ storage: storagePlayers });

// ------------------------------
// ????????? Multer ??? ??????? xlsx ?????? (? ??????)
// ------------------------------
const uploadXlsx = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('????????? ?????? ????? .xlsx ? .xls'), false);
    }
  }
});

function fixUrl(url) {
  if (!url) return url; // -ï¿½-ï¿½-+-+ URL -+-ï¿½-ï¿½-ï¿½-+-ï¿½, -ï¿½-+-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+ -ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½
  if ((url.startsWith("http:/") && !url.startsWith("http://")) ||
      (url.startsWith("https:/") && !url.startsWith("https://"))) {
    return url.replace(/^https?:\//, match => match + '/');
  }
  return url;
}


// ------------------------------
// -ï¿½-ï¿½-ï¿½-ï¿½-+-+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½-ï¿½ -+-ï¿½-ï¿½-+ -ï¿½-+-ï¿½ Side_logo -+ winType_logo
// ------------------------------
// -P-+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½ baseUrl -ï¿½-+-+-ï¿½-+-+ -ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-+-+-ï¿½-+-+-ï¿½-ï¿½-ï¿½-ï¿½-+-+ -+-+-+ -+-+ -+-ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-+-ï¿½
const runningInRailway = !!process.env.RAILWAY_STATIC_URL;
const defaultBaseUrl = runningInRailway ? `https://${process.env.RAILWAY_STATIC_URL}` : `http://localhost:${port}`;
const baseUrl = process.env.BASE_URL || defaultBaseUrl;

const sideLogos = {
  "CT": `${baseUrl}/side_logos/ct.png`,
  "T":  `${baseUrl}/side_logos/t.png`
};

const winTypeLogos = {
  "bomb":        `${baseUrl}/winType_logos/bomb.png`,
  "elimination": `${baseUrl}/winType_logos/elimination.png`,
  "time":        `${baseUrl}/winType_logos/time.png`,
  "defuse":      `${baseUrl}/winType_logos/defuse.png`
};

// -ï¿½-ï¿½-ï¿½-+-+-ï¿½-+-ï¿½-ï¿½ -+-+-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-+-ï¿½ -ï¿½-+-ï¿½ -ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½, -ï¿½-+-ï¿½-ï¿½-ï¿½ -+-+-ï¿½-+-ï¿½-+-+ -+-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-+
const defaultSideLogo = `${baseUrl}/side_logos/none.png`;
const defaultWinTypeLogo = `${baseUrl}/winType_logos/None.png`;
const defaultImage = `${baseUrl}/winType_logos/None.png`; // -ï¿½-+-ï¿½ -ï¿½-+-+-ï¿½-+-ï¿½, -ï¿½-ï¿½-+-+ -+-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-+ -+-+-ï¿½-+-ï¿½-+-+
const defaultPlayerImage = `${baseUrl}/NoneP.png`;
// ------------------------------
// 1) -P-ï¿½-+-+-ï¿½-+-ï¿½-+-+-ï¿½-ï¿½ -ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½ -ï¿½-+-ï¿½ -+-+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½ -ï¿½-+-+--ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-+-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-+-ï¿½
// ------------------------------
function getRoundCount() {
  let roundsFromWins = scoreboard.map && scoreboard.map.round_wins ? Object.keys(scoreboard.map.round_wins).length : 0;
  let roundsFromMap = scoreboard.map && scoreboard.map.round ? scoreboard.map.round : 0;
  // -ï¿½-ï¿½-+-+-+-ï¿½-+-ï¿½-ï¿½-+ -+-ï¿½-ï¿½-ï¿½-+-+-ï¿½-+-ï¿½-+-+-ï¿½ -+-+-ï¿½-ï¿½-ï¿½-+-+-ï¿½, -ï¿½-ï¿½-+-ï¿½-ï¿½ -ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-+ -ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+
  return Math.max(roundsFromWins, roundsFromMap);
}

// ------------------------------
// 2) -ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½ -ï¿½-+-ï¿½ -+-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ ADR (accumulatedDmg / -ï¿½-+-+-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+_-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-+-ï¿½-ï¿½_-ï¿½-ï¿½-ï¿½-+-ï¿½-+-ï¿½)
// ------------------------------
function getAverageDamage(steamId) {
  const totalDamage = scoreboard.players[steamId]?.accumulatedDmg || 0;
  const roundsPlayed = getRoundCount();
  if (roundsPlayed > 0) {
    // -ï¿½-+-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+ -+-+-ï¿½-ï¿½-ï¿½-+-+-ï¿½ -ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½ -ï¿½ -+-ï¿½-+-+-+ -+-+-ï¿½-ï¿½-+-+ -+-+-ï¿½-+-ï¿½ -+-ï¿½-+-ï¿½-ï¿½-+-ï¿½
    return (totalDamage / roundsPlayed).toFixed(1);
  }
  return "0.0";
}

// ------------------------------
// -ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-+-ï¿½-+-+-ï¿½ -+-ï¿½-+-ï¿½-+-ï¿½-+-ï¿½-+ ADR -ï¿½-+-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-ï¿½-+-ï¿½-+-ï¿½
// ------------------------------
function computeFinalADR() {
  const roundsPlayed = getRoundCount();
  const finalADR = {};
  for (const steamId in scoreboard.players) {
    const totalDamage = scoreboard.players[steamId]?.accumulatedDmg || 0;
    if (roundsPlayed > 0) {
      finalADR[steamId] = parseFloat((totalDamage / roundsPlayed).toFixed(1));
    } else {
      finalADR[steamId] = 0;
    }
  }
  return { roundsPlayed, finalADR };
}

// ------------------------------
// -ï¿½-ï¿½-+-+-+-+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-+-ï¿½-ï¿½ -ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½ -ï¿½-+-ï¿½ -+-+-+-ï¿½-ï¿½-ï¿½-+-+-ï¿½ -+-+-ï¿½-+-ï¿½-+-+-ï¿½ -ï¿½-+-+-ï¿½-+-ï¿½-ï¿½ -+-+ -ï¿½-ï¿½-+-+-ï¿½-+ -+-ï¿½-ï¿½-+-ï¿½-ï¿½
// ------------------------------
function getTeamLogo(playerData) {
  let teamLogo = null;
  // -ï¿½-+-ï¿½-ï¿½-ï¿½-+-ï¿½ -+-ï¿½-ï¿½-+ -+-ï¿½-ï¿½-+-ï¿½-ï¿½ -ï¿½ -ï¿½-ï¿½-+-ï¿½ -ï¿½-+-ï¿½ -+-+-+-ï¿½-ï¿½-ï¿½-+-+-ï¿½ teamId
  const regPlayer = players.find(p => p.steamId?.toLowerCase() === playerData.steamid?.toLowerCase());
  if (regPlayer && regPlayer.teamId) {
    const teamObj = teams.find(t => t.id === regPlayer.teamId);
    if (teamObj && teamObj.logo) {
      teamLogo = `${baseUrl}${teamObj.logo}`;
    }
  }
  // -ï¿½-ï¿½-+-+ -+-ï¿½ -+-ï¿½-ï¿½-+-+ -+-+ teamId, -+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½ -+-ï¿½-ï¿½-ï¿½-+ -ï¿½-+-+-ï¿½-+-ï¿½-ï¿½ -+-+ -+-+-ï¿½-+-+
  if (!teamLogo && playerData.team) {
    let teamName = playerData.team;
    if (teamName === "CT" && scoreboard.map.team_ct && scoreboard.map.team_ct.name) {
      teamName = scoreboard.map.team_ct.name;
    } else if (teamName === "T" && scoreboard.map.team_t && scoreboard.map.team_t.name) {
      teamName = scoreboard.map.team_t.name;
    }
    const regTeam = teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());
    if (regTeam && regTeam.logo) {
      teamLogo = `${baseUrl}${regTeam.logo}`;
    }
  }
  return teamLogo || defaultImage;
}

// ------------------------------
// -ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½ -ï¿½-+-ï¿½ -ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-ï¿½-+-+-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ -+-ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-+-+-ï¿½-+ -+-ï¿½-ï¿½-+-ï¿½-ï¿½
// ------------------------------
function getObserverData() {
  let observedData = null;

  // 1) ???? API /player ??????? ???????? ??????
  if (scoreboard.player && scoreboard.player.steamid) {
    let p = { ...scoreboard.player };
    const reg = players.find(pl => pl.steamId?.toLowerCase() === p.steamid?.toLowerCase());
    if (reg) {
      if (reg.name) p.name = reg.name;
      if (!p.photo && reg.photo) p.photo = reg.photo;
    }
    observedData = {
      steamId: p.steamid,
      name: p.name,
      kills: p.match_stats ? p.match_stats.kills : 0,
      deaths: p.match_stats ? p.match_stats.deaths : 0,
      adr: getAverageDamage(p.steamid),
      team: p.team,
      photo: getTeamLogo(p),
      observer_slot: p.observer_slot
    };
  }

  // 2) ???? ???, ??????? ????????? ?? observer_slot
  if (!observedData) {
    const slot = scoreboard.player?.observer_slot ?? "0";
    for (const steamId in scoreboard.players) {
      const p = scoreboard.players[steamId];
      if (p.observer_slot !== undefined && String(p.observer_slot) === String(slot)) {
        let pd = { ...p };
        const reg = players.find(pl => pl.steamId?.toLowerCase() === steamId.toLowerCase());
        if (reg) {
          if (reg.name) pd.name = reg.name;
          if (!pd.photo && reg.photo) pd.photo = reg.photo;
        }
        observedData = {
          steamId,
          name: pd.name,
          kills: pd.match_stats ? pd.match_stats.kills : 0,
          deaths: pd.match_stats ? pd.match_stats.deaths : 0,
          adr: getAverageDamage(steamId),
          team: pd.team,
          photo: getTeamLogo(pd),
          observer_slot: pd.observer_slot
        };
        break;
      }
    }
  }

  // 3) ????????
  if (!observedData) {
    observedData = {
      steamId: "",
      name: "",
      kills: 0,
      deaths: 0,
      adr: "0.0",
      team: "",
      photo: defaultImage,
      observer_slot: ""
    };
  }
  return observedData;
}

// ------------------------------
// WebSocket -ï¿½-+-ï¿½ -+-ï¿½-+-+-ï¿½-+-ï¿½-+-+-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ -+-ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½ -ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-+ -ï¿½-ï¿½-ï¿½-+-ï¿½-+-+
// ------------------------------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcastObserverUpdate() {
  const data = JSON.stringify([getObserverData()]);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('WebSocket--ï¿½-+-ï¿½-ï¿½-+-+-ï¿½-+-+-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-+-+-ï¿½-+-ï¿½-+-+');
  ws.send(JSON.stringify([getObserverData()]));
  
  // -ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½-+ -+-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+, -+-ï¿½-+-+-ï¿½-+-ï¿½-+-+-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -+-+ GSI POST
  // const intervalId = setInterval(() => {
  //   if (ws.readyState === WebSocket.OPEN) {
  //     ws.send(JSON.stringify([getObserverData()]));
  //   }
  // }, 1000);
  
  ws.on('close', () => {
    // clearInterval(intervalId); // -ï¿½-+-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-+-+, -ï¿½-ï¿½-+ -ï¿½-+-ï¿½-ï¿½ -ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½-+
    console.log('WebSocket--ï¿½-+-ï¿½-ï¿½-+-+-ï¿½-+-+-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+');
  });
});

// ------------------------------
// -ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½ -ï¿½-+-ï¿½ -ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-ï¿½-+-+-ï¿½ -+-+-ï¿½-+-ï¿½-+-ï¿½-ï¿½-+-+ -+ -ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½
// ------------------------------
function createRoundInfo(roundNumber, winString) {
  let roundInfo = {
    roundNumber,
    Team: "",
    Side: "",
    winType: "",
    team_logo: defaultImage,
    Side_logo: defaultSideLogo,
    winType_logo: defaultWinTypeLogo
  };

  if (winString) {
    const parts = winString.split('_win_');
    let side = null,
        winType = "",
        teamName = "",
        team_logo = null;
    
    if (parts.length === 2) {
      side = parts[0].toUpperCase();
      winType = parts[1];
      
      // -ï¿½-+-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ 12 -ï¿½-ï¿½-ï¿½-+-ï¿½-+-ï¿½ -+-ï¿½-+-+-+-ï¿½-+-ï¿½-ï¿½-+ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-+-+-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½
      if (roundNumber <= 12) { // -ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-+-ï¿½-ï¿½ -+-+-ï¿½-+-ï¿½-ï¿½
        if (side === "CT") {
          teamName = (scoreboard.map.original_team_ct && scoreboard.map.original_team_ct.name)
            ? scoreboard.map.original_team_ct.name
            : "CT";
          const regTeam = teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());
          if (regTeam && regTeam.logo) {
            team_logo = `${baseUrl}${regTeam.logo}`;
          }
        } else if (side === "T") {
          teamName = (scoreboard.map.original_team_t && scoreboard.map.original_team_t.name)
            ? scoreboard.map.original_team_t.name
            : "T";
          const regTeam = teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());
          if (regTeam && regTeam.logo) {
            team_logo = `${baseUrl}${regTeam.logo}`;
          }
        }
      } else {
        // -ï¿½-+-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-+-ï¿½ -ï¿½ 13--ï¿½-+ -+-ï¿½-+-+-+-ï¿½-+-ï¿½-ï¿½-+ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½
        if (side === "CT") {
          teamName = (scoreboard.map.team_ct && scoreboard.map.team_ct.name)
            ? scoreboard.map.team_ct.name
            : "CT";
          const regTeam = teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());
          if (regTeam && regTeam.logo) {
            team_logo = `${baseUrl}${regTeam.logo}`;
          }
        } else if (side === "T") {
          teamName = (scoreboard.map.team_t && scoreboard.map.team_t.name)
            ? scoreboard.map.team_t.name
            : "T";
          const regTeam = teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());
          if (regTeam && regTeam.logo) {
            team_logo = `${baseUrl}${regTeam.logo}`;
          }
        }
      }
      
      const side_logo = side && sideLogos[side] ? sideLogos[side] : defaultSideLogo;
      const winType_logo = winType && winTypeLogos[winType] ? winTypeLogos[winType] : defaultWinTypeLogo;
      const team_logo_final = team_logo ? team_logo : defaultImage;
      
      roundInfo = {
        roundNumber,
        Team: teamName,
        Side: side,
        winType: winType,
        team_logo: team_logo_final,
        Side_logo: side_logo,
        winType_logo: winType_logo
      };
    }
  }

  return roundInfo;
}

// ------------------------------
// -P-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ GSI -+-ï¿½ CS:GO/CS2 (POST "/")
// ------------------------------
app.post('/', (req, res) => {
  const data = req.body;
  lastScoreboardUpdate = new Date().toISOString();
  if (!data) {
    return res.status(400).json({ error: "-ï¿½-ï¿½-ï¿½ -+-+-+-ï¿½-ï¿½-ï¿½-+-+-ï¿½-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ -ï¿½ -ï¿½-+-ï¿½-+-ï¿½-ï¿½-ï¿½ JSON" });
  }
  
  if (data.map && data.map.round === 1) { // -ï¿½-ï¿½-+-+ data.map.round === 1, -+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-+ -ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½
    const finalStats = computeFinalADR();
    console.log("-ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+. -ï¿½-ï¿½-+-ï¿½-+-ï¿½-ï¿½-ï¿½ ADR:", finalStats);
    scoreboard.players = {};
    roundsHistory = [];
    roundsAlive = [];
    resetOverallRoundTracker();
    resetGsiKillTracker();
    // ??????? ???? ?????, ???? ??? ????? ????? ??????
    currentMatchKey = buildMatchKey(data.map);
    // scoreboard.map = {}; // -ï¿½-ï¿½-+ -+-+-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-+-+-ï¿½-ï¿½-+-+ -ï¿½-ï¿½-+-+, -ï¿½-ï¿½-+-+ -ï¿½-ï¿½-ï¿½ -+-ï¿½-ï¿½-+-ï¿½ original_team_ct/t
  }
  
  if (data.map) {
    if (!scoreboard.map.name || scoreboard.map.name !== data.map.name) {
      console.log("-ï¿½-+-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½:", data.map.name, "Gï¿½ï¿½ -ï¿½-ï¿½-+-+-+-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½");
      if (scoreboard.map.name) { // -ï¿½-ï¿½-+-+ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-+-ï¿½
        const finalStats = computeFinalADR();
        console.log("-ï¿½-ï¿½-+-ï¿½-+-ï¿½-ï¿½-ï¿½ ADR -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-+-+-ï¿½-+ -+-ï¿½-ï¿½-ï¿½-ï¿½:", finalStats);
      }
      scoreboard.players = {}; // -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+ -+-ï¿½-ï¿½-+-ï¿½-+-ï¿½ -+-ï¿½-+ -ï¿½-+-ï¿½-+-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½
      roundsHistory = [];
      roundsAlive = [];
      resetOverallRoundTracker();
      resetGsiKillTracker();
      // scoreboard.map = {}; // -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½
      // -ï¿½-ï¿½-+ -+-+-ï¿½-+-+ -+-ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-+-+-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½ -ï¿½-+-ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-+
      scoreboard.map = { // -ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-+-+-ï¿½-ï¿½-ï¿½-+ -+-+-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -+ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-+-ï¿½-ï¿½ -ï¿½-+-+-ï¿½-+-ï¿½-ï¿½
        ...data.map,
        original_team_ct: data.map.team_ct ? {...data.map.team_ct} : null, // -ï¿½-+-+-+-ï¿½-ï¿½-ï¿½-+ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½
        original_team_t: data.map.team_t ? {...data.map.team_t} : null
      };
      currentMatchKey = buildMatchKey(data.map);
    } else {
      // ?? ?? ?????. ???????? ????? ??????? (????? ??????).
      const incomingMatchKey = buildMatchKey(data.map);
      if (incomingMatchKey && currentMatchKey && incomingMatchKey !== currentMatchKey) {
        console.log(`???? ????????? ??? ??? ?? ?????: ${currentMatchKey} -> ${incomingMatchKey}. ?????????? ??????? ??????? ? ???????.`);
        const finalStats = computeFinalADR();
        console.log("????????? ADR ????? ???????:", finalStats);
        scoreboard.players = {};
        roundsHistory = [];
        roundsAlive = [];
        resetOverallRoundTracker();
        resetGsiKillTracker();
        // ??????????? ????? ? ??????????? ????? ???????????? ???????
        scoreboard.map = {
          ...data.map,
          original_team_ct: data.map.team_ct ? {...data.map.team_ct} : null,
          original_team_t: data.map.team_t ? {...data.map.team_t} : null
        };
        currentMatchKey = incomingMatchKey;
      } else {
        // ??????? ?????????? ????? ????? ??? ?????? original_team_ct/t
        scoreboard.map = {
          ...scoreboard.map,
          ...data.map
        };
        // ??? ?????? ?????? ??????????? ????
        if (!currentMatchKey && incomingMatchKey) {
          currentMatchKey = incomingMatchKey;
        }
      }
    }
  }
  
  if (data.allplayers) {
    for (const steamId in data.allplayers) {
      const newPlayerData = data.allplayers[steamId];
      if (!scoreboard.players[steamId]) {
        scoreboard.players[steamId] = { accumulatedDmg: 0, previousRoundDmg: 0 };
      }
      scoreboard.players[steamId] = { ...scoreboard.players[steamId], ...newPlayerData };
      
      // -ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-+-ï¿½-ï¿½ -+-+-ï¿½-+-ï¿½-ï¿½ ADR:
      const roundDmgNow = newPlayerData?.state?.round_totaldmg || 0;
      const roundDmgPrev = scoreboard.players[steamId].previousRoundDmg || 0;
      if (roundDmgNow < roundDmgPrev) { // -ï¿½-ï¿½-ï¿½-+-ï¿½, -ï¿½-ï¿½-+-+ -+-+-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-+-+ -+-ï¿½-+-ï¿½-ï¿½-ï¿½ -+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+ (-+-ï¿½-ï¿½-ï¿½-+-+ -+-+-ï¿½-+-ï¿½-+ -ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½)
        scoreboard.players[steamId].previousRoundDmg = 0;
      } else {
        const diff = roundDmgNow - roundDmgPrev;
        if (diff > 0) {
          scoreboard.players[steamId].accumulatedDmg += diff;
        }
        scoreboard.players[steamId].previousRoundDmg = roundDmgNow;
      }
    }
  }
  
  if (data.player) { // -P-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ -+-ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½-ï¿½-+-+-ï¿½-+ -+-ï¿½-ï¿½-+-ï¿½-ï¿½, -ï¿½-ï¿½-+-+ -+-+-+ -+-ï¿½ -ï¿½ allplayers
    scoreboard.player = data.player;
    const pSteam = data.player.steamid;
    if (pSteam && (!data.allplayers || !data.allplayers[pSteam])) {
      if (!scoreboard.players[pSteam]) {
        scoreboard.players[pSteam] = { accumulatedDmg: 0, previousRoundDmg: 0 };
      }
      scoreboard.players[pSteam] = { ...scoreboard.players[pSteam], ...data.player };
      // -ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-+-ï¿½-ï¿½ -+-+-ï¿½-+-ï¿½-ï¿½ ADR -ï¿½-+-ï¿½ data.player:
      const roundDmgNow = data.player?.state?.round_totaldmg || 0;
      const roundDmgPrev = scoreboard.players[pSteam].previousRoundDmg || 0;
       if (roundDmgNow < roundDmgPrev) {
        scoreboard.players[pSteam].previousRoundDmg = 0;
      } else {
        const diff = roundDmgNow - roundDmgPrev;
        if (diff > 0) {
          scoreboard.players[pSteam].accumulatedDmg += diff;
        }
        scoreboard.players[pSteam].previousRoundDmg = roundDmgNow;
      }
    }
  }

  updateOverallRoundTrackerFromScoreboard();
  processGsiKillTracking();
  
  console.log("-ï¿½-+-+-ï¿½-ï¿½-ï¿½-+-ï¿½ -ï¿½-ï¿½-+-+-ï¿½-ï¿½ GSI (-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½):", JSON.stringify(data, null, 2).substring(0, 300) + "...");

  if (scoreboard.map && scoreboard.map.round_wins) {
    // -P-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-+ -ï¿½-ï¿½-ï¿½-ï¿½ -+-+-ï¿½-+-ï¿½-ï¿½ -ï¿½-+-ï¿½ roundsHistory
    Object.keys(scoreboard.map.round_wins).forEach(roundKey => {
      const roundNumber = parseInt(roundKey, 10);
      if (!roundsHistory.find(r => r.roundNumber === roundNumber)) {
        const winString = scoreboard.map.round_wins[roundKey];
        const newRound = createRoundInfo(roundNumber, winString);
        roundsHistory.push(newRound);
      }
    });
    roundsHistory.sort((a, b) => a.roundNumber - b.roundNumber);
  }
  
  if (scoreboard.map && scoreboard.map.round_wins) {
    // -P-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-+ -ï¿½-ï¿½-ï¿½-ï¿½ -+-+-ï¿½-+-ï¿½-ï¿½ -ï¿½-+-ï¿½ roundsAlive
    Object.keys(scoreboard.map.round_wins).forEach(roundKey => {
      const roundNumber = parseInt(roundKey, 10);
      if (!roundsAlive.find(r => r.round === roundNumber)) {
        let aliveCT = 0;
        let aliveT = 0;
        for (const steamId in scoreboard.players) {
          const player = scoreboard.players[steamId];
          if (player.team === "CT" && player.state && player.state.health > 0) aliveCT++;
          if (player.team === "T" && player.state && player.state.health > 0) aliveT++;
        }
        roundsAlive.push({
          round: roundNumber, CT: aliveCT, T: aliveT,
          images: { CT: `alive/ct${aliveCT}.png`, T: `alive/t${aliveT}.png` }
        });
      }
    });
    roundsAlive.sort((a, b) => a.round - b.round);
  }
  
  broadcastObserverUpdate();
  stats.onGsiUpdate(data, players, teams);
  res.status(200).json({ message: "-ï¿½-ï¿½-+-+-ï¿½-ï¿½ -+-+-+-ï¿½-ï¿½-ï¿½-+-ï¿½" });
});

// ------------------------------
// -ï¿½-ï¿½-+-ï¿½-+-ï¿½ endpoints (REST API)
// ------------------------------
app.get('/gsi', (req, res) => res.json(scoreboard));
app.get('/scoreboard', (req, res) => res.json(scoreboard));

app.get('/score', (req, res) => {
  let ctPlayers = [];
  let tPlayers = [];

  for (const steamId in scoreboard.players) {
    let player = { ...scoreboard.players[steamId] };
    const regPlayer = players.find(p => p.steamId?.toLowerCase() === steamId.toLowerCase());
    if (regPlayer) {
      if (regPlayer.name) player.name = regPlayer.name;
      if (!player.photo && regPlayer.photo) player.photo = regPlayer.photo;
    }

    let photoFull = defaultPlayerImage;
    if (player.photo) {
      photoFull = player.photo.startsWith("http") ? fixUrl(player.photo) : `${baseUrl}${player.photo.startsWith('/') ? '' : '/'}${player.photo}`;
    }

    const team = player.team;
    if (team === "CT" || team === "T") {
      const playerData = {
        steamId, name: player.name,
        kills: player.match_stats?.kills || 0,
        assists: player.match_stats?.assists || 0,
        deaths: player.match_stats?.deaths || 0,
        adr: getAverageDamage(steamId),
        team, photo: photoFull
      };
      if (team === "CT") ctPlayers.push(playerData);
      else tPlayers.push(playerData);
    }
  }

  ctPlayers.sort((a, b) => b.kills - a.kills);
  tPlayers.sort((a, b) => b.kills - a.kills);

  const teamCT = scoreboard.map?.team_ct || { name: "CT", score: 0, timeouts_remaining: 0 };
  const teamT = scoreboard.map?.team_t || { name: "T", score: 0, timeouts_remaining: 0 };

  const registeredTeamCT = teams.find(t => t.name?.toLowerCase() === teamCT.name?.toLowerCase());
  const registeredTeamT = teams.find(t => t.name?.toLowerCase() === teamT.name?.toLowerCase());

  const teamCTLogo = registeredTeamCT?.logo
    ? `${baseUrl}${registeredTeamCT.logo.startsWith('/') ? '' : '/'}${registeredTeamCT.logo}`
    : `${baseUrl}/logos/none-team.png`;
  const teamTLogo = registeredTeamT?.logo
    ? `${baseUrl}${registeredTeamT.logo.startsWith('/') ? '' : '/'}${registeredTeamT.logo}`
    : `${baseUrl}/logos/none-team.png`;

  const mapInfo = {
    CT: { ...teamCT, logo: teamCTLogo },
    T: { ...teamT, logo: teamTLogo }
  };

  const playersArr = [
    ...ctPlayers.map(p => ({ ...p, teamName: teamCT.name, teamLogo: teamCTLogo })),
    ...tPlayers.map(p => ({ ...p, teamName: teamT.name, teamLogo: teamTLogo }))
  ];

  res.json({ mapInfo, players: playersArr });
});


app.get('/teams', (req, res) => {
  const teamCTFromGSI = scoreboard.map?.team_ct || { name: "CT", score: 0, timeouts_remaining: 0 };
  const teamTFromGSI  = scoreboard.map?.team_t || { name: "T", score: 0, timeouts_remaining: 0 };

  const registeredTeamCT = teams.find(t => t.name.toLowerCase() === teamCTFromGSI.name.toLowerCase());
  const registeredTeamT  = teams.find(t => t.name.toLowerCase() === teamTFromGSI.name.toLowerCase());

  let mapName = scoreboard.map?.name?.replace(/^de_/, '') || "Unknown";
  
  // ??????? ??? ?????? ????? ????? ?????????? ?? ????????
  function findMapImage(mapName) {
    const mapDir = path.join(__dirname, 'public', 'map');
    try {
      const files = fs.readdirSync(mapDir);
      // ???? ????, ????????? ???????
      const foundFile = files.find(file => 
        file.toLowerCase() === `${mapName.toLowerCase()}.png`
      );
      return foundFile || `${mapName}.png`; // ?????????? ????????? ???? ??? ???????? ???
    } catch (error) {
      console.log('Error reading map directory:', error);
      return `${mapName}.png`; // ?????????? ???????? ??? ??? ??????
    }
  }
  
  const mapFileName = findMapImage(mapName);
  const mapUrl = `${baseUrl}/map/${mapFileName}`;

  let teamsData = [
    { 
      team: "CT", teamName: registeredTeamCT?.name || teamCTFromGSI.name, 
      score: teamCTFromGSI.score, timeoutsRemaining: teamCTFromGSI.timeouts_remaining,
      logo: registeredTeamCT?.logo ? `${baseUrl}${registeredTeamCT.logo}` : defaultImage,
      mapName: mapName,
      mapLogo: mapUrl
    },
    { 
      team: "T", teamName: registeredTeamT?.name || teamTFromGSI.name, 
      score: teamTFromGSI.score, timeoutsRemaining: teamTFromGSI.timeouts_remaining,
      logo: registeredTeamT?.logo ? `${baseUrl}${registeredTeamT.logo}` : defaultImage,
      mapName: mapName,
      mapLogo: mapUrl
    }
  ];
  
  res.json({ teams: teamsData, currentMapImage: mapUrl });
});

app.get('/rounds', (req, res) => {
  const totalRounds = 24; // -ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-+-+-ï¿½ -+-+-ï¿½-ï¿½-ï¿½-+-+-ï¿½
  let roundsData = [];
  for (let i = 1; i <= totalRounds; i++) {
    let roundInfo = roundsHistory.find(r => r.roundNumber === i);
    if (!roundInfo) {
      roundInfo = {
        roundNumber: i, Team: "", Side: "", winType: "",
        team_logo: defaultImage, Side_logo: defaultSideLogo, winType_logo: defaultWinTypeLogo
      };
    }
    roundsData.push(roundInfo);
  }
  res.json({ mapName: scoreboard.map?.name || "Unknown", rounds: roundsData });
});

app.get('/mvp', (req, res) => {
  let mvp = null;
  let mvpScore = -1;
  const roundsPlayed = getRoundCount();

  for (const steamId in scoreboard.players) {
    let player = { ...scoreboard.players[steamId] }; // -ï¿½-ï¿½-+-+-ï¿½-ï¿½ -+-+ GSI
    const regPlayer = players.find(p => p.steamId?.toLowerCase() === steamId.toLowerCase()); // -ï¿½-ï¿½-+-+-ï¿½-ï¿½ -+-+ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-+-+-+-ï¿½-+

    const name = regPlayer?.name || player.name; // -ï¿½-ï¿½-+-+-ï¿½-+-ï¿½-ï¿½-ï¿½ -+-+-ï¿½-+-+ -+-+ -ï¿½-ï¿½-+-+-+-ï¿½-+
    const photoFromReg = regPlayer?.photo; // -ï¿½-+-ï¿½-+ -+-+ -ï¿½-ï¿½-+-+-+-ï¿½-+

    const team = player.team;
    if (team === "CT" || team === "T") {
      const kills = player.match_stats?.kills || 0;
      const assists = player.match_stats?.assists || 0;
      const adrNum = parseFloat(getAverageDamage(steamId));
      
      const scoreValue = kills + assists + adrNum; // -ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-+-ï¿½-ï¿½ -ï¿½-+-ï¿½-+-ï¿½-+-ï¿½ MVP
      
      if (scoreValue > mvpScore && roundsPlayed > 0) { // MVP -ï¿½-+-+-ï¿½-ï¿½-+ -ï¿½-ï¿½-+-+ -ï¿½-ï¿½-+-+ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½ -ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½
        mvpScore = scoreValue;
        const photoFull = photoFromReg ? `${baseUrl}${photoFromReg.startsWith('/') ? '' : '/'}${photoFromReg}` : defaultPlayerImage;
        
        let team_logo = defaultImage; // -ï¿½-ï¿½-+-+-+-ï¿½-+-ï¿½-ï¿½-+ defaultImage -+-+ -ï¿½-+-+-+-ï¿½-ï¿½-+-+-ï¿½
        let team_name = "";

        // -ï¿½-+-ï¿½-+-ï¿½-ï¿½ -+-+-ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½ -+-+-ï¿½-+-+ -ï¿½-+-+-ï¿½-+-ï¿½-ï¿½ -+ -+-+-ï¿½-+-ï¿½-+-+-ï¿½ -+-+ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-+-+-ï¿½-+ -ï¿½-+-ï¿½-ï¿½
        if (regPlayer && regPlayer.teamId) {
          const teamObj = teams.find(t => t.id === regPlayer.teamId);
          if (teamObj) {
            team_logo = teamObj.logo ? `${baseUrl}${teamObj.logo}` : defaultImage;
            team_name = teamObj.name;
          }
        }
        if (!team_name) { // -ï¿½-ï¿½-+-+ -+-+ teamId -+-ï¿½ -+-ï¿½-ï¿½-+-+ -+-+-+ regPlayer -+-ï¿½-ï¿½
          let actualTeamName = team;
          if (team === "CT" && scoreboard.map?.team_ct?.name) {
            actualTeamName = scoreboard.map.team_ct.name;
          } else if (team === "T" && scoreboard.map?.team_t?.name) {
            actualTeamName = scoreboard.map.team_t.name;
          }
          const regTeamByName = teams.find(t => t.name.toLowerCase() === actualTeamName.toLowerCase());
          if (regTeamByName) {
            team_logo = regTeamByName.logo ? `${baseUrl}${regTeamByName.logo}` : defaultImage;
            team_name = regTeamByName.name;
          } else {
            team_name = actualTeamName; // -ï¿½-ï¿½-+-+ -+ -+-+ -+-+-ï¿½-+-+ -+-ï¿½ -+-ï¿½-ï¿½-+-+, -ï¿½-ï¿½-ï¿½-ï¿½-+ "CT" -+-+-+ "T"
          }
        }
        
        mvp = { 
          steamId, name, team, team_name, kills, assists, 
          deaths: player.match_stats?.deaths || 0, adr: adrNum, 
          mvpScore, // -ï¿½-ï¿½-+-+ mvpScore: scoreValue, -+-+-+-ï¿½-+-+-+ -+-ï¿½ mvpScore -ï¿½-+-ï¿½ -ï¿½-+-+-ï¿½-+-ï¿½-ï¿½-ï¿½-+-ï¿½-+-+-ï¿½-ï¿½-+
          photo: photoFull, team_logo,
          // -ï¿½-ï¿½-ï¿½-ï¿½ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½-+-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-+-ï¿½-ï¿½-+-ï¿½-ï¿½
          kdRatio: parseFloat(player.match_stats?.deaths > 0 ? (kills / player.match_stats.deaths).toFixed(2) : kills.toFixed(2)),
          kpr: parseFloat(roundsPlayed > 0 ? (kills / roundsPlayed).toFixed(2) : "0.00"),
          kda: parseFloat(player.match_stats?.deaths > 0 ? ((kills + assists) / player.match_stats.deaths).toFixed(2) : (kills + assists).toFixed(2)),
          plusMinus: kills - (player.match_stats?.deaths || 0),
          totalDMG: player.accumulatedDmg || 0, // -ï¿½-ï¿½-+-+-+-ï¿½-+-ï¿½-ï¿½-+ accumulatedDmg
          kast: player.match_stats?.kast ?? "N/A", // -ï¿½-ï¿½-+-+-+-ï¿½-+-ï¿½-ï¿½-+ ?? -ï¿½-+-ï¿½ N/A
          dpr: parseFloat(adrNum.toFixed(2)), // -ï¿½-ï¿½-+ -ï¿½-+ -ï¿½-ï¿½, -ï¿½-ï¿½-+ -+ adr, -+-+ -ï¿½ toFixed
          hsPercent: parseFloat(kills > 0 && player.match_stats?.headshots ? ((player.match_stats.headshots / kills) * 100).toFixed(2) : "0.00"),
          headshots: player.match_stats?.headshots || 0,
          accuracy: player.match_stats?.shots > 0 && player.match_stats?.hits ? ((player.match_stats.hits / player.match_stats.shots) * 100).toFixed(2) : "N/A"
        };
      }
    }
  }
  res.json(mvp ? [mvp] : []); // -ï¿½-+-+-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-+ -+-ï¿½-ï¿½-ï¿½-+-ï¿½
});


app.get('/observer', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const observedData = getObserverData();
  res.json([observedData]);
});

app.get('/admin', (req, res) => {
  console.log('Admin page requested');
  console.log('Teams:', teams.length);
  console.log('Players:', players.length);
  try {
    res.render('admin', { teams, players });
  } catch (error) {
    console.error('Error rendering admin page:', error);
    res.status(500).send('Error rendering admin page: ' + error.message);
  }
});

app.get('/admin/graphics', (req, res) => {
  try {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${port}`;
    const origin = `${protocol}://${host}`;
    res.render('admin-graphics', {
      origin,
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        shortName: t.shortName || t.name?.substring(0, 3)?.toUpperCase() || '',
        logo: t.logo || '/logos/none-team.png'
      }))
    });
  } catch (error) {
    console.error('Error rendering admin graphics page:', error);
    res.status(500).send('Error rendering admin graphics page: ' + error.message);
  }
});

app.get('/stats', (req, res) => {
  res.render('stats');
});

// ???????? ???????? ???????
// Legacy route: redirect to main admin
app.get('/admin-test', (req, res) => res.redirect(302, '/admin'));

// ??????? ???????? ???????
// Legacy route: redirect to main admin
app.get('/admin-simple', (req, res) => res.redirect(302, '/admin'));

// ???????????? ???????? ???????
// Legacy route: redirect to main admin
app.get('/admin-fixed', (req, res) => res.redirect(302, '/admin'));

// ???????? ?? ??????? ????????? ???? (???????? ??????????? ?? public/map)
app.get('/maps', (req, res) => {
  try {
    // ??????? ??? ????? ??? ???????? de_
    let mapName = scoreboard.map?.name?.replace(/^de_/, '') || 'Unknown';

    // ????? ??????????? ????? ??? ????? ????????, ????????? public/map ? public/maps
    function findMapImage(name) {
      const candidateDirs = [
        path.join(__dirname, 'public', 'map'),
        path.join(__dirname, 'public', 'maps')
      ];
      const lower = String(name || '').toLowerCase();
      for (const dir of candidateDirs) {
        try {
          const files = fs.readdirSync(dir);
          const match = files.find(f => f.toLowerCase() === `${lower}.png`);
          if (match) {
            return { file: match, dirName: path.basename(dir) };
          }
        } catch (e) {
          // ignore and try next
        }
      }
      // ??????: ???????????? public/map
      return { file: `${name}.png`, dirName: 'map' };
    }

    const { file: mapFileName, dirName: mapDirName } = findMapImage(mapName);
    const mapImagePath = `/${mapDirName}/${mapFileName}`; // ????????????? ???? ??? ??????????? ???????
    const mapUrl = `${baseUrl}${mapImagePath}`;            // ?????????? URL

    const teamCTFromGSI = scoreboard.map?.team_ct || { name: 'CT', score: 0, timeouts_remaining: 0 };
    const teamTFromGSI  = scoreboard.map?.team_t  || { name: 'T',  score: 0, timeouts_remaining: 0 };

    const registeredTeamCT = teams.find(t => t.name.toLowerCase() === (teamCTFromGSI.name || 'CT').toLowerCase());
    const registeredTeamT  = teams.find(t => t.name.toLowerCase() === (teamTFromGSI.name  || 'T').toLowerCase());

    const response = {
      map: {
        name: scoreboard.map?.name || 'Unknown',
        round: scoreboard.map?.round || 0,
        phase: scoreboard.map?.phase || '',
        round_wins: scoreboard.map?.round_wins || {}
      },
      teams: {
        CT: {
          name: registeredTeamCT?.name || teamCTFromGSI.name,
          score: teamCTFromGSI.score,
          timeoutsRemaining: teamCTFromGSI.timeouts_remaining,
          logo: registeredTeamCT?.logo ? `${baseUrl}${registeredTeamCT.logo}` : defaultImage
        },
        T: {
          name: registeredTeamT?.name || teamTFromGSI.name,
          score: teamTFromGSI.score,
          timeoutsRemaining: teamTFromGSI.timeouts_remaining,
          logo: registeredTeamT?.logo ? `${baseUrl}${registeredTeamT.logo}` : defaultImage
        }
      },
  // ????????????? ? ????? ???? ? ?????? ? ??????????? ?????
  currentMapImage: mapUrl,         // ?????????? URL (??? ??????)
  mapImageFile: mapFileName,       // ??? ?????, ????. overpass.png
  mapImagePath,                    // ????????????? ????, ????. /map/overpass.png
  mapImageUrl: mapUrl,             // ?????????? URL, ????. http://.../map/overpass.png
      roundsHistory,
      roundsAlive
    };

    res.json(response);
  } catch (error) {
    console.error('Error handling /maps:', error);
    res.status(500).json({ error: 'Error handling /maps', message: error.message });
  }
});

// ==================================
// === -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-P -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ API -ï¿½-ï¿½-ï¿½ CRUD ===
// ==================================

// --- API -ï¿½-+-ï¿½ -ï¿½-+-+-ï¿½-+-ï¿½ ---
app.get('/api/teams', (req, res) => {
  const base = req.protocol + '://' + req.get('host');
  const result = teams.map(t => ({ ...t, logo: t.logo && t.logo.startsWith('/') ? base + t.logo : t.logo }));
  res.json(result);
});

// -ï¿½-P-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½ -ï¿½-P-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -P-ï¿½-ï¿½-P-ï¿½ -ï¿½-P-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½
app.get('/api/teams/:id', (req, res) => {
  const { id } = req.params;
  const team = teams.find(t => t.id === id);
  if (team) {
    res.json(team);
  } else {
    res.status(404).json({ error: "Team not found with ID: " + id });
  }
});

app.post('/api/teams', (req, res) => {
  const { name, logo, score, vrsPoints, vrsPeak } = req.body;
  if (!name) return res.status(400).json({error: "Team name is required"});
  const newTeam = { id: Date.now().toString(), name, logo: logo || null, score: score || 0, vrsPoints: vrsPoints !== undefined ? Number(vrsPoints) : null, vrsPeak: vrsPeak !== undefined ? Number(vrsPeak) : null };
  teams.push(newTeam);
  saveData();
  res.status(201).json(newTeam);
});

app.put('/api/teams/:id', (req, res) => {
  const { id } = req.params;
  const { name, logo, score, vrsPoints, vrsPeak } = req.body;
  const teamIndex = teams.findIndex(t => t.id === id);
  if (teamIndex === -1) return res.status(404).json({ error: "Team not found" });
  
  teams[teamIndex].name  = name  !== undefined ? name  : teams[teamIndex].name;
  teams[teamIndex].logo  = logo  !== undefined ? logo  : teams[teamIndex].logo;
  teams[teamIndex].score = score !== undefined ? (score || 0) : teams[teamIndex].score;
  if (vrsPoints !== undefined) teams[teamIndex].vrsPoints = vrsPoints === '' ? null : Number(vrsPoints);
  if (vrsPeak   !== undefined) teams[teamIndex].vrsPeak   = vrsPeak   === '' ? null : Number(vrsPeak);
  saveData();
  res.json(teams[teamIndex]);
});

app.delete('/api/teams/:id', (req, res) => {
  const { id } = req.params;
  const originalLength = teams.length;
  teams = teams.filter(t => t.id !== id); // -ï¿½-ï¿½-+-+-+-ï¿½-+-ï¿½-ï¿½-+ filter, -ï¿½-ï¿½-ï¿½ -ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-+ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½
  if (teams.length < originalLength) {
    players = players.map(p => p.teamId === id ? { ...p, teamId: null } : p);
    saveData();
    res.status(200).json({ message: "Team deleted" }); // -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ 200
  } else {
    res.status(404).json({ error: "Team not found" });
  }
});

app.post('/api/teams/uploadLogo', uploadTeams.single('logoFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = '/logos/' + req.file.filename;
  res.json({ path: filePath });
});

// --- API -ï¿½-+-ï¿½ -+-ï¿½-ï¿½-+-ï¿½-+-ï¿½ ---
app.get('/api/players', (req, res) => {
  const base = req.protocol + '://' + req.get('host');
  const result = players.map(p => ({ ...p, photo: p.photo && p.photo.startsWith('/') ? base + p.photo : p.photo }));
  res.json(result);
});

// -ï¿½-P-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½ -ï¿½-P-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ -P-ï¿½-ï¿½-P-ï¿½-P -ï¿½-ï¿½-ï¿½-P-ï¿½-ï¿½
app.get('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const player = players.find(p => p.id === id);
  if (player) {
    res.json(player);
  } else {
    res.status(404).json({ error: "Player not found with ID: " + id });
  }
});

app.post('/api/players', (req, res) => {
  const { name, steamId, photo, teamId, match_stats, firstName, lastName, country } = req.body; // -P-ï¿½-ï¿½-ï¿½-ï¿½-+-+ match_stats
  if (!name) return res.status(400).json({error: "Player name is required"});
  const newPlayer = { 
    id: Date.now().toString(), name, steamId: steamId || null, 
    photo: photo || null, teamId: teamId || null, 
    match_stats: match_stats || {}, // -ï¿½-+-+-ï¿½-+-ï¿½-+-+-+-+-ï¿½-ï¿½-ï¿½-+, -ï¿½-ï¿½-ï¿½ -ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-+ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½
    firstName: firstName || null,
    lastName: lastName || null,
    country: country ? country.toUpperCase() : null
  };
  players.push(newPlayer);
  saveData();
  res.status(201).json(newPlayer); // -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ 201
});

app.put('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const { name, steamId, photo, teamId, match_stats, firstName, lastName, country } = req.body; // -P-ï¿½-ï¿½-ï¿½-ï¿½-+-+ match_stats
  const playerIndex = players.findIndex(p => p.id === id); // -ï¿½-ï¿½-+-+-+-ï¿½-+-ï¿½-ï¿½-+ findIndex
  if (playerIndex === -1) return res.status(404).json({ error: "Player not found" });
  
  players[playerIndex].name = name !== undefined ? name : players[playerIndex].name;
  players[playerIndex].steamId = steamId !== undefined ? (steamId || null) : players[playerIndex].steamId;
  players[playerIndex].photo = photo !== undefined ? (photo || null) : players[playerIndex].photo;
  players[playerIndex].teamId = teamId !== undefined ? (teamId || null) : players[playerIndex].teamId;
  players[playerIndex].match_stats = match_stats !== undefined ? (match_stats || {}) : players[playerIndex].match_stats;
  players[playerIndex].firstName = firstName !== undefined ? (firstName || null) : players[playerIndex].firstName;
  players[playerIndex].lastName = lastName !== undefined ? (lastName || null) : players[playerIndex].lastName;
  players[playerIndex].country = country !== undefined ? (country ? country.toUpperCase() : null) : players[playerIndex].country;
  saveData();
  res.json(players[playerIndex]);
});

app.delete('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const originalLength = players.length;
  players = players.filter(p => p.id !== id); // -ï¿½-ï¿½-+-+-+-ï¿½-+-ï¿½-ï¿½-+ filter, -ï¿½-ï¿½-ï¿½ -ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-+ -+-ï¿½-+-ï¿½-+-+-ï¿½-+-ï¿½
  if (players.length < originalLength) {
    saveData();
    res.status(200).json({ message: "Player deleted" }); // -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ 200
  } else {
    res.status(404).json({ error: "Player not found" });
  }
});

app.post('/api/players/uploadPhoto', uploadPlayers.single('photoFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = '/players/' + req.file.filename;
  res.json({ path: filePath });
});

// ================================
// === STATS API ===
// ================================

// ======================================
// === EXPORT JSON API ===
// ======================================

// GET /api/export/teams ï¿½ ??? ??????? + ?????????? + ????? + VRS
app.get('/api/export/teams', (req, res) => {
  const history = stats.getMatchHistory();
  const teamRatings = stats.getGlobalTeamRatings(teams);

  const result = teams.map(t => {
    const rating = teamRatings.find(r => r.name === t.name) || {};

    // ??? ????? ???? ???????
    const teamMatches = history.filter(m =>
      (m.teamCT?.name||'').toLowerCase() === t.name.toLowerCase() ||
      (m.teamT?.name||'').toLowerCase()  === t.name.toLowerCase()
    ).map(m => {
      const isHome = (m.teamCT?.name||'').toLowerCase() === t.name.toLowerCase();
      const opp = isHome ? m.teamT : m.teamCT;
      const myScore  = isHome ? (m.teamCT?.score ?? 0) : (m.teamT?.score ?? 0);
      const oppScore = isHome ? (m.teamT?.score  ?? 0) : (m.teamCT?.score ?? 0);
      const result   = !m.winner ? 'draw'
        : m.winner.toLowerCase() === t.name.toLowerCase() ? 'win' : 'loss';
      return {
        matchId:   m.id,
        date:      m.finishedAt || m.startedAt,
        map:       m.mapName || null,
        opponent:  opp?.name || null,
        score:     `${myScore}:${oppScore}`,
        result,
        rounds:    m.roundCount || 0,
      };
    });

    // ?????? ?? ?????? (??? ?????)
    const mapWinrates = {};
    teamMatches.forEach(tm => {
      const key = (tm.map || 'unknown').replace('de_', '');
      if (!mapWinrates[key]) mapWinrates[key] = { map: key, played: 0, won: 0, lost: 0, winRate: 0 };
      mapWinrates[key].played++;
      if (tm.result === 'win') mapWinrates[key].won++;
      else if (tm.result === 'loss') mapWinrates[key].lost++;
    });
    Object.values(mapWinrates).forEach(m => {
      m.winRate = m.played ? +(m.won / m.played * 100).toFixed(1) : 0;
    });

    return {
      id:            t.id,
      name:          t.name,
      logo:          t.logo || null,
      vrs: {
        currentPoints: t.vrsPoints ?? null,
        peakPoints:    t.vrsPeak   ?? null,
      },
      stats: {
        matchesPlayed: rating.matchesPlayed || 0,
        matchesWon:    rating.matchesWon    || 0,
        matchesLost:   rating.matchesLost   || 0,
        winRate:       rating.winRate       || 0,
        roundsWon:     rating.roundsWon     || 0,
        roundsLost:    rating.roundsLost    || 0,
        roundWinRate:  rating.roundWinRate  || 0,
      },
      mapWinrates: Object.values(mapWinrates).sort((a,b) => b.played - a.played),
      matches: teamMatches.sort((a,b) => new Date(b.date) - new Date(a.date)),
    };
  });

  res.json(result);
});

// GET /api/export/players ï¿½ ??? ?????? + ?????? ??????????
app.get('/api/export/players', (req, res) => {
  const ratings = stats.getGlobalPlayerRatings(players);

  const result = players.map(p => {
    const r = ratings.find(x => x.steamId === p.steamId) || {};
    const mkr = r.rounds
      ? +(((r.threeKills||0)*3 + (r.fourKills||0)*4 + (r.fiveKills||0)*5) / r.rounds).toFixed(4)
      : 0;

    return {
      id:       p.id,
      name:     p.name   || null,
      steamId:  p.steamId || null,
      photo:    p.photo  || null,
      team:     p.teamId || null,
      stats: r.matchesPlayed ? {
        matchesPlayed:   r.matchesPlayed,
        galaxyRating:    r.galaxyRating,
        killsPerRound:   +r.kpr,
        deathsPerRound:  +r.dpr,
        kastPercent:     r.kast,
        adr:             r.adr,
        kdRatio:         +r.kd,
        heatShotPercent: r.hsRate,
        multikillRating: mkr,
        kills:           r.kills,
        deaths:          r.deaths,
        assists:         r.assists,
        rounds:          r.rounds,
        mvps:            r.mvps    || 0,
        firstKills:      r.firstKills  || 0,
        firstDeaths:     r.firstDeaths || 0,
        threeKillRounds: r.threeKills  || 0,
        fourKillRounds:  r.fourKills   || 0,
        aces:            r.fiveKills   || 0,
        bombPlants:      r.bombPlants  || 0,
        bombDefuses:     r.bombDefuses || 0,
      } : null,
    };
  });

  res.json(result);
});

// ======================================

// GET /api/stats/match ï¿½ ??????? ????
app.get('/api/stats/match', (req, res) => {
  const match = stats.getCurrentMatchStats();
  if (!match) return res.json({ status: 'no_match', data: null });
  res.json({ status: 'live', data: match });
});

// GET /api/stats/players ï¿½ ?????????? ??????? ???????
app.get('/api/stats/players', (req, res) => {
  res.json(stats.getGlobalPlayerRatings(players));
});

// GET /api/stats/teams ï¿½ ?????????? ??????? ??????
app.get('/api/stats/teams', (req, res) => {
  res.json(stats.getGlobalTeamRatings(teams));
});

// GET /api/stats/history ï¿½ ??????? ??????
app.get('/api/stats/history', (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(50, parseInt(req.query.limit || '20'));
  const all   = stats.getMatchHistory();
  res.json({
    total: all.length,
    page,
    limit,
    data: all.slice((page - 1) * limit, page * limit),
  });
});

// GET /api/stats/history/:id ï¿½ ???? ???? ?? ???????
app.get('/api/stats/history/:id', (req, res) => {
  const match = stats.getMatchHistory().find(m => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  res.json(match);
});

// DELETE /api/stats/history/:id ï¿½ ??????? ???? ? ??????????? ?????????? ??????????
app.delete('/api/stats/history/:id', (req, res) => {
  const ok = stats.deleteMatch(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Match not found' });
  res.json({ ok: true });
});

// GET /api/stats/global ï¿½ ????? ??????????? ??????
app.get('/api/stats/global', (req, res) => {
  res.json(stats.getGlobalStats());
});

// GET /api/stats/maps ï¿½ ?????????? ?? ??????
app.get('/api/stats/maps', (req, res) => {
  res.json(stats.getMapStats());
});

// GET /api/stats/player/:steamId ï¿½ ??????? ??????
app.get('/api/stats/player/:steamId', (req, res) => {
  const data = stats.getPlayerStats(req.params.steamId, players);
  if (!data) return res.status(404).json({ error: 'Player not found' });
  res.json(data);
});

// GET /api/stats/team/:name ï¿½ ??????? ???????
app.get('/api/stats/team/:name', (req, res) => {
  const data = stats.getTeamStats(req.params.name, teams, players);
  if (!data) return res.status(404).json({ error: 'Team not found' });
  res.json(data);
});

// Pages for player/team profiles
app.get('/stats/player', (req, res) => res.render('stats-player'));
app.get('/stats/team',   (req, res) => res.render('stats-team'));

// ================================
// === ?????? ?? XLSX ?????? ===
// ================================

/**
 * ????????? ?????????? ??????????? ?? xlsx-??????.
 * ?????????? ?????? { rowIndex: { data: Buffer, ext: string } },
 * ??? rowIndex ï¿½ 0-based ?????? ?????? ? drawing (0 = ?????????, 1 = ?????? ?????? ??????).
 */
function extractXlsxImageMap(buffer) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(buffer);
    const relsEntry = zip.getEntry('xl/drawings/_rels/drawing1.xml.rels');
    const drawingEntry = zip.getEntry('xl/drawings/drawing1.xml');
    if (!relsEntry || !drawingEntry) return {};

    // rId ? ??? ????? ? xl/media/
    const ridToFile = {};
    const relsXml = relsEntry.getData().toString('utf8');
    for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]+Target="[^"]*\/([^"/]+)"/g)) {
      ridToFile[m[1]] = m[2];
    }

    // ?????? drawing (0-based) ? ?????? ???????????
    const drawingXml = drawingEntry.getData().toString('utf8');
    const rowToImage = {};
    for (const anchor of drawingXml.split(/<xdr:(?:one|two)CellAnchor/).slice(1)) {
      const rowM = anchor.match(/<xdr:row>(\d+)<\/xdr:row>/);
      const rIdM = anchor.match(/r:embed="(rId\d+)"/);
      if (!rowM || !rIdM) continue;
      const mediaFile = ridToFile[rIdM[1]];
      if (!mediaFile) continue;
      const entry = zip.getEntry('xl/media/' + mediaFile);
      if (!entry) continue;
      rowToImage[parseInt(rowM[1])] = {
        data: entry.getData(),
        ext: path.extname(mediaFile) || '.png'
      };
    }
    return rowToImage;
  } catch (e) {
    console.error('extractXlsxImageMap:', e.message);
    return {};
  }
}

/** Sanitize a string for use in filenames */
function safeFilename(name) {
  return name.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
}

// POST /api/import/teams ï¿½ ?????? ?????? ?? xlsx
app.post('/api/import/teams', uploadXlsx.single('xlsxFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '???? ?? ????????' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

    if (rows.length < 2) return res.status(400).json({ error: '???? ???? ??? ?? ???????? ??????' });

    const headers = rows[0].map(h => String(h || '').trim().toLowerCase());

    // ?????? ?? ????????? ???????? ????? ??????? ? ?????? ??????
    if (headers.includes('username') || headers.includes('steamid')) {
      return res.status(400).json({ error: '??????, ?? ????????? ???? ???????. ??? ??????? ?????? ??????????? ???? ? ???????? "Team name" ??? ??????? Username/SteamID.' });
    }

    const teamNameIdx = headers.findIndex(h => h === 'team name');
    const logoIdx = headers.findIndex(h => ['logo', 'team logo', 'avatar'].includes(h));

    if (teamNameIdx === -1) return res.status(400).json({ error: '??????? "Team name" ?? ??????? ? ?????' });

    const imageMap = extractXlsxImageMap(req.file.buffer);
    const logosDir = path.join(__dirname, 'public', 'logos');
    if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

    let created = 0, skipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = row[teamNameIdx] ? String(row[teamNameIdx]).trim() : null;
      if (!name) continue;

      const exists = teams.find(t => t.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        skipped++;
        continue;
      }

      // ?????????? ???????: ??????? ?? ???????, ????? ?? ??????????? ???????????
      let logo = null;
      if (logoIdx !== -1 && row[logoIdx]) {
        const val = String(row[logoIdx]).trim();
        if (/^https?:\/\//i.test(val) || val.startsWith('/')) {
          logo = val;
        }
      }
      if (!logo && imageMap[i]) {
        const fname = safeFilename(name) + imageMap[i].ext;
        fs.writeFileSync(path.join(logosDir, fname), imageMap[i].data);
        logo = '/logos/' + fname;
      }

      const newTeam = { id: Date.now().toString() + '_' + i, name, logo, score: 0 };
      teams.push(newTeam);
      created++;
    }

    if (created > 0) saveData();
    res.json({
      message: `?????? ????????: ??????? ${created} ??????, ????????? ${skipped} (??? ??????????)`,
      created,
      skipped
    });
  } catch (err) {
    console.error('?????? ??? ???????? xlsx:', err);
    res.status(500).json({ error: '?????? ??? ??????? ?????: ' + err.message });
  }
});

// POST /api/import/players ï¿½ ?????? ??????? ?? xlsx
app.post('/api/import/players', uploadXlsx.single('xlsxFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '???? ?? ????????' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

    if (rows.length < 2) return res.status(400).json({ error: '???? ???? ??? ?? ???????? ??????' });

    const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
    const usernameIdx = headers.findIndex(h => h === 'username');
    const steamIdIdx = headers.findIndex(h => h === 'steamid');
    const teamNameIdx = headers.findIndex(h => h === 'team name');
    const photoIdx = headers.findIndex(h => ['avatar', 'photo'].includes(h));
    const firstNameIdx = headers.findIndex(h => h === 'first name');
    const lastNameIdx = headers.findIndex(h => h === 'last name');
    const countryIdx = headers.findIndex(h => h === 'country code' || h === 'country');

    if (usernameIdx === -1) return res.status(400).json({ error: '??????? "Username" ?? ??????? ? ?????' });

    const imageMap = extractXlsxImageMap(req.file.buffer);
    const playersDir = path.join(__dirname, 'public', 'players');
    if (!fs.existsSync(playersDir)) fs.mkdirSync(playersDir, { recursive: true });

    let created = 0, skipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = row[usernameIdx] ? String(row[usernameIdx]).trim() : null;
      if (!name) continue;

      const steamId = (steamIdIdx !== -1 && row[steamIdIdx]) ? String(row[steamIdIdx]).trim() : null;

      // ????????? ????????????? ?? steamId (?????????) ??? ?? ????
      let exists = null;
      if (steamId) {
        exists = players.find(p => p.steamId && p.steamId.toLowerCase() === steamId.toLowerCase());
      }
      if (!exists) {
        exists = players.find(p => p.name.toLowerCase() === name.toLowerCase());
      }
      if (exists) {
        skipped++;
        continue;
      }

      // ???? ??????? ?? ?????
      let teamId = null;
      if (teamNameIdx !== -1 && row[teamNameIdx]) {
        const teamName = String(row[teamNameIdx]).trim();
        const teamObj = teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());
        if (teamObj) teamId = teamObj.id;
      }

      // ?????????? ????: ??????? ?? ???????, ????? ?? ??????????? ???????????
      let photo = null;
      if (photoIdx !== -1 && row[photoIdx]) {
        const val = String(row[photoIdx]).trim();
        if (/^https?:\/\//i.test(val) || val.startsWith('/')) {
          photo = val;
        }
      }
      if (!photo && imageMap[i]) {
        const fname = safeFilename(name) + imageMap[i].ext;
        fs.writeFileSync(path.join(playersDir, fname), imageMap[i].data);
        photo = '/players/' + fname;
      }

      const newPlayer = {
        id: Date.now().toString() + '_' + i,
        name,
        steamId: steamId || null,
        photo,
        teamId,
        match_stats: {},
        firstName: (firstNameIdx !== -1 && row[firstNameIdx]) ? String(row[firstNameIdx]).trim() : null,
        lastName: (lastNameIdx !== -1 && row[lastNameIdx]) ? String(row[lastNameIdx]).trim() : null,
        country: (countryIdx !== -1 && row[countryIdx]) ? String(row[countryIdx]).trim().toUpperCase() : null
      };
      players.push(newPlayer);
      created++;
    }

    if (created > 0) saveData();
    res.json({
      message: `?????? ????????: ??????? ${created} ???????, ????????? ${skipped} (??? ??????????)`,
      created,
      skipped
    });
  } catch (err) {
    console.error('?????? ??? ???????? xlsx:', err);
    res.status(500).json({ error: '?????? ??? ??????? ?????: ' + err.message });
  }
});

// ================================
// === -ï¿½-P-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ API -ï¿½-ï¿½-ï¿½ CRUD ===
// ================================


app.get('/alive', (req, res) => res.json(roundsAlive));

// ================================
// === GRAPHICS API (Broadcast/Overlay) ===
// ================================

/**
 * GET /api/graphics/scoreboard
 * Returns live scoreboard data in broadcast-ready format
 * Designed for GB Next Gen Overlay and titling systems
 */
app.get('/api/graphics/scoreboard', (req, res) => {
  try {
    // Prepare team objects
    const teamCT = scoreboard.map?.team_ct || { name: "CT", score: 0 };
    const teamT = scoreboard.map?.team_t || { name: "T", score: 0 };

    // Resolve team profiles
    const teamAProfile = graphicsUtils.resolveTeamProfileFromGSI(teamCT, 'CT', teams, baseUrl);
    const teamBProfile = graphicsUtils.resolveTeamProfileFromGSI(teamT, 'T', teams, baseUrl);

    const roundsPlayed = toNumber(getRoundCount(), 0);
    const completedRounds = scoreboard.map?.round_wins ? Object.keys(scoreboard.map.round_wins).length : Math.max(0, roundsPlayed - 1);

    // Collect all live players from active sides
    const playersData = [];

    for (const steamId in scoreboard.players) {
      const gsiPlayer = scoreboard.players[steamId];
      const side = gsiPlayer.team;

      if (side !== 'CT' && side !== 'T') continue;

      // Resolve player profile
      const regPlayer = graphicsUtils.resolvePlayerBySteamId(steamId, players);

      const roundStats = getOverallRoundStatsForPlayer(steamId, roundsPlayed);
      const playerProfile = buildScoreboardOverallPlayer({
        steamId,
        sourcePlayer: gsiPlayer,
        regPlayer,
        teamProfile: side === 'CT' ? teamAProfile : teamBProfile,
        side,
        roundsPlayed,
        completedRounds,
        roundStats,
        baseUrl
      });

      playersData.push(playerProfile);
    }

    // Keep stable player list (10 slots) ranked best -> worst globally
    const rankedPlayers = sortPlayersBestToWorst(playersData).slice(0, 10);
    const stablePlayers = buildStablePlayerList(rankedPlayers, 10);
    const meaningfulPlayers = stablePlayers.filter((p) => !p.isPlaceholder);

    // Team slices for overlay bindings: always 5 slots, sorted best -> worst
    const rankedTeamAPlayers = sortPlayersBestToWorst(meaningfulPlayers.filter((p) => p.side === 'CT')).slice(0, 5);
    const rankedTeamBPlayers = sortPlayersBestToWorst(meaningfulPlayers.filter((p) => p.side === 'T')).slice(0, 5);
    const teamAPlayers = buildTeamSlotList(rankedTeamAPlayers, 5).map((player, index) => normalizePlayerStatsShape({ ...player, scoreboardRank: index + 1 }, { placeholder: !!player?.isPlaceholder }));
    const teamBPlayers = buildTeamSlotList(rankedTeamBPlayers, 5).map((player, index) => normalizePlayerStatsShape({ ...player, scoreboardRank: index + 1 }, { placeholder: !!player?.isPlaceholder }));

    const rankByKey = new Map();
    teamAPlayers.forEach((player) => {
      const key = normalizeSteamId(player.steamId || player.id);
      if (key) rankByKey.set(key, player.scoreboardRank);
    });
    teamBPlayers.forEach((player) => {
      const key = normalizeSteamId(player.steamId || player.id);
      if (key) rankByKey.set(key, player.scoreboardRank);
    });

    const rankedStablePlayers = stablePlayers.map((player) => {
      const key = normalizeSteamId(player.steamId || player.id);
      const teamRank = key ? rankByKey.get(key) : null;
      return normalizePlayerStatsShape({ ...player, scoreboardRank: teamRank ?? player.scoreboardRank ?? null }, { placeholder: !!player?.isPlaceholder });
    });

    const playersTable = buildPlayersTableRows(rankedStablePlayers);
    const teamAPlayersTable = buildPlayersTableRows(teamAPlayers);
    const teamBPlayersTable = buildPlayersTableRows(teamBPlayers);
    const statsDebug = buildStatsDebug({
      players: rankedStablePlayers,
      playersTable,
      rawScoreboardPlayers: scoreboard.players
    });

    // Prepare response
    const response = {
      mode: 'scoreboard',
      type: 'overall_scoreboard',
      matchId: scoreboard.matchId || null,
      map: scoreboard.map?.name || null,
      round: scoreboard.map?.round || 0,
      phase: scoreboard.map?.phase || 'unknown',
      updatedAt: new Date().toISOString(),

      teamA: teamAProfile,
      teamB: teamBProfile,

      sides: {
        CT: {
          teamId: teamAProfile.id,
          name: teamAProfile.name,
          logo: teamAProfile.logo,
          score: teamAProfile.score
        },
        T: {
          teamId: teamBProfile.id,
          name: teamBProfile.name,
          logo: teamBProfile.logo,
          score: teamBProfile.score
        }
      },

      players: rankedStablePlayers,
      playersTable,

      teamAPlayers,
      teamBPlayers,
      teamAPlayersTable,
      teamBPlayersTable,

      teams: {
        teamAPlayers,
        teamBPlayers,
        ctPlayers: teamAPlayers,
        tPlayers: teamBPlayers
      },

      topPlayers: buildOverallTopPlayers(meaningfulPlayers),
      statAvailability: buildOverallStatAvailability(meaningfulPlayers),
      statsDebug
    };

    res.json(response);
  } catch (err) {
    console.error('Error in /api/graphics/scoreboard:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * GET /api/graphics/teams
 * Returns all teams with players and basic stats for team selection
 */
app.get('/api/graphics/teams', (req, res) => {
  try {
    const teamStats = readJsonSafe(STORAGE_FILES.teamStats, {});

    const teamsData = teams.map(team => {
      const tStats = teamStats[team.id] || teamStats[team.name] || null;
      // Get players in this team - use normalizer for full fields
      const teamPlayers = players.filter(p => p.teamId === team.id).map(p => {
        const firstName = p.firstName || p['First Name'] || null;
        const lastName = p.lastName || p['Last Name'] || null;
        const countryCode = (p.countryCode || p['Country Code'] || p.country || '').toUpperCase() || null;
        return {
          id: p.id,
          steamId: p.steamId || null,
          name: p.name,
          nickname: p.nickname || p.name,
          firstName: firstName,
          lastName: lastName,
          fullName: firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || p.name,
          countryCode: countryCode,
          role: p.role || '',
          photo: graphicsUtils.resolvePlayerPhoto(p, baseUrl),
          teamId: team.id,
          teamName: team.name
        };
      });

      const stats = tStats ? {
        matchesPlayed: tStats.matchesPlayed || 0,
        wins: tStats.wins || 0,
        losses: tStats.losses || 0,
        winRate: tStats.winRate != null ? tStats.winRate : (tStats.matchesPlayed > 0 ? parseFloat(((tStats.wins || 0) / tStats.matchesPlayed * 100).toFixed(1)) : 0),
        mapsPlayed: tStats.mapsPlayed || 0,
        mapsWon: tStats.mapsWon || 0,
        mapsLost: tStats.mapsLost || 0,
        mapWinRate: tStats.mapWinRate != null ? tStats.mapWinRate : (tStats.mapsPlayed > 0 ? parseFloat(((tStats.mapsWon || 0) / tStats.mapsPlayed * 100).toFixed(1)) : 0),
        currentStreak: tStats.currentStreak || '',
        lastMatches: Array.isArray(tStats.lastMatches) ? tStats.lastMatches : []
      } : {
        matchesPlayed: 0, wins: 0, losses: 0, winRate: 0,
        mapsPlayed: 0, mapsWon: 0, mapsLost: 0, mapWinRate: 0,
        currentStreak: '', lastMatches: []
      };

      return {
        id: team.id,
        name: team.name,
        shortName: team.shortName || team.name.substring(0, 3).toUpperCase(),
        tag: team.tag || team.shortName || team.name.substring(0, 3).toUpperCase(),
        logo: graphicsUtils.resolveLogo(team, baseUrl),
        country: team.country || null,
        countryCode: (team.countryCode || team.country || '').toUpperCase() || null,
        playersCount: teamPlayers.length,
        players: teamPlayers,
        stats: stats,
        mapStats: tStats?.mapStats || {},
        lastMatches: stats.lastMatches
      };
    });

    res.json({
      mode: 'teams',
      updatedAt: new Date().toISOString(),
      count: teamsData.length,
      teams: teamsData
    });
  } catch (err) {
    console.error('Error in /api/graphics/teams:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * GET /api/graphics/team/:teamId
 * Returns specific team details with players and stats
 */
app.get('/api/graphics/team/:teamId', (req, res) => {
  try {
    const { teamId } = req.params;
    const team = teams.find(t => t.id === teamId);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Get players in this team
    const teamPlayers = players.filter(p => p.teamId === team.id).map(p => ({
      id: p.id,
      steamId: p.steamId,
      name: p.name,
      nickname: p.nickname || p.name,
      photo: graphicsUtils.resolvePlayerPhoto(p, baseUrl),
      country: p.country || '',
      role: p.role || ''
    }));

    const teamData = {
      id: team.id,
      name: team.name,
      shortName: team.shortName || team.name.substring(0, 3).toUpperCase(),
      logo: graphicsUtils.resolveLogo(team, baseUrl),
      country: team.country || '',
      players: teamPlayers,
      coach: team.coach || '',
      stats: {
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        mapsPlayed: 0,
        mapsWon: 0,
        mapsLost: 0,
        mapWinRate: 0,
        currentStreak: '',
        lastMatches: []
      },
      mapStats: {},
      createdAt: team.createdAt || null,
      updatedAt: team.updatedAt || new Date().toISOString()
    };

    res.json(teamData);
  } catch (err) {
    console.error('Error in /api/graphics/team/:teamId:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * GET /api/graphics/prematch?teamA=team_001&teamB=team_002
 * Returns prematch data for two teams including head-to-head stats
 */
app.get('/api/graphics/prematch', (req, res) => {
  try {
    const { teamA: teamAId, teamB: teamBId } = req.query;
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${port}`;
    const requestBaseUrl = `${protocol}://${host}`;

    const teamStats = readJsonSafe(STORAGE_FILES.teamStats, {});
    const h2hData = readJsonSafe(STORAGE_FILES.headToHead, {});
    const playerStatsData = readJsonSafe(STORAGE_FILES.playerStats, {});
    const mapStatsData = readJsonSafe(STORAGE_FILES.mapStats, {});
    const completedMatches = readJsonSafe(STORAGE_FILES.completedMatches, []);

    if (!teamAId && !teamBId) {
      const normalizedTeams = teams
        .map((team) => graphicsUtils.normalizeTeamForGraphics(team, players, requestBaseUrl))
        .filter((team) => team !== null);

      const normalizedPlayers = players
        .map((player) => {
          const playerTeam = teams.find((team) => team.id === player.teamId) || null;
          return graphicsUtils.normalizePlayerForGraphics(player, playerTeam, requestBaseUrl);
        })
        .filter((player) => player !== null);

      const rosters = normalizedTeams.map((team) => ({
        id: team.id,
        name: team.name,
        shortName: team.shortName,
        logo: team.logo,
        playersCount: team.playersCount,
        players: team.players
      }));

      return res.json({
        mode: 'prematch',
        type: 'prematch_database',
        updatedAt: new Date().toISOString(),
        teams: normalizedTeams,
        players: normalizedPlayers,
        rosters,
        teamStats,
        playerStats: playerStatsData,
        mapStats: mapStatsData,
        headToHead: h2hData,
        completedMatches: Array.isArray(completedMatches) ? completedMatches : [],
        upcomingMatches: [],
        availableTeams: normalizedTeams.map((team) => ({
          id: team.id,
          name: team.name,
          shortName: team.shortName,
          logo: team.logo
        }))
      });
    }

    if (!teamAId || !teamBId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'Provide both teamA and teamB for comparison mode, or no params for prematch database mode'
      });
    }

    const teamA = teams.find(t => t.id === teamAId);
    const teamB = teams.find(t => t.id === teamBId);

    if (!teamA || !teamB) {
      return res.status(404).json({ error: 'One or both teams not found' });
    }

    // H2H key check both directions
    const h2hKey = `${teamAId}_vs_${teamBId}`;
    const h2hKeyRev = `${teamBId}_vs_${teamAId}`;
    const h2hRaw = h2hData[h2hKey] || h2hData[h2hKeyRev] || null;

    const headToHead = h2hRaw ? {
      matchesPlayed: h2hRaw.matchesPlayed || 0,
      teamAWins: h2hData[h2hKey] ? (h2hRaw.wins || 0) : (h2hRaw.losses || 0),
      teamBWins: h2hData[h2hKey] ? (h2hRaw.losses || 0) : (h2hRaw.wins || 0),
      recentMatches: Array.isArray(h2hRaw.recentMatches) ? h2hRaw.recentMatches : [],
      mapBreakdown: h2hRaw.mapBreakdown || {}
    } : {
      matchesPlayed: 0, teamAWins: 0, teamBWins: 0, recentMatches: [], mapBreakdown: {}
    };

    const buildTeamProfile = (team) => {
      const tStats = teamStats[team.id] || null;
      const teamPlayers = players.filter(p => p.teamId === team.id).map(p => {
        const pStats = playerStatsData[p.steamId] || playerStatsData[p.id] || null;
        const firstName = p.firstName || p['First Name'] || null;
        const lastName = p.lastName || p['Last Name'] || null;
        const countryCode = (p.countryCode || p['Country Code'] || p.country || '').toUpperCase() || null;
        return {
          id: p.id,
          steamId: p.steamId || null,
          nickname: p.nickname || p.name,
          firstName: firstName,
          lastName: lastName,
          fullName: firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || p.name,
          countryCode: countryCode,
          role: p.role || '',
          photo: graphicsUtils.resolvePlayerPhoto(p, baseUrl),
          stats: pStats ? {
            matchesPlayed: pStats.matchesPlayed || 0,
            kills: pStats.kills || 0,
            deaths: pStats.deaths || 0,
            kd: pStats.kd || 0,
            adr: pStats.adr || 0,
            rating: pStats.rating || 0
          } : { matchesPlayed: 0, kills: 0, deaths: 0, kd: 0, adr: 0, rating: 0 }
        };
      });

      const stats = tStats ? {
        matchesPlayed: tStats.matchesPlayed || 0,
        wins: tStats.wins || 0,
        losses: tStats.losses || 0,
        winRate: tStats.winRate != null ? tStats.winRate : 0,
        mapsPlayed: tStats.mapsPlayed || 0,
        mapsWon: tStats.mapsWon || 0,
        mapsLost: tStats.mapsLost || 0,
        mapWinRate: tStats.mapWinRate != null ? tStats.mapWinRate : 0,
        currentStreak: tStats.currentStreak || '',
        lastMatches: Array.isArray(tStats.lastMatches) ? tStats.lastMatches : []
      } : {
        matchesPlayed: 0, wins: 0, losses: 0, winRate: 0,
        mapsPlayed: 0, mapsWon: 0, mapsLost: 0, mapWinRate: 0,
        currentStreak: '', lastMatches: []
      };

      return {
        id: team.id,
        name: team.name,
        shortName: team.shortName || team.name.substring(0, 3).toUpperCase(),
        logo: graphicsUtils.resolveLogo(team, baseUrl),
        players: teamPlayers,
        stats: stats,
        mapStats: tStats?.mapStats || {},
        lastMatches: stats.lastMatches
      };
    };

    const teamAProfile = buildTeamProfile(teamA);
    const teamBProfile = buildTeamProfile(teamB);

    // Top players by rating/adr
    const topPlayers = (teamPlayers) => [...teamPlayers]
      .sort((a, b) => (b.stats?.rating || 0) - (a.stats?.rating || 0))
      .slice(0, 3);

    res.json({
      mode: 'prematch',
      updatedAt: new Date().toISOString(),
      teamA: teamAProfile,
      teamB: teamBProfile,
      headToHead: headToHead,
      mapComparison: {},
      topPlayers: {
        teamA: topPlayers(teamAProfile.players),
        teamB: topPlayers(teamBProfile.players)
      }
    });
  } catch (err) {
    console.error('Error in /api/graphics/prematch:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * GET /api/graphics/postmatch
 * GET /api/graphics/match/:matchId/final
 * Returns postmatch data - last completed match
 * Phase 4 endpoint
 */
app.get('/api/graphics/postmatch', (req, res) => {
  try {
    const POSTMATCH_FILE = STORAGE_FILES.postmatch;

    const postmatch = fs.existsSync(POSTMATCH_FILE)
      ? JSON.parse(fs.readFileSync(POSTMATCH_FILE, 'utf8'))
      : getIdlePostmatch();

    const teamAValue = postmatch.teamA || null;
    const teamBValue = postmatch.teamB || null;
    const teamAName = extractTeamNameValue(teamAValue);
    const teamBName = extractTeamNameValue(teamBValue);
    const teamAId = extractTeamIdValue(teamAValue);
    const teamBId = extractTeamIdValue(teamBValue);

    const teamAProfile = typeof teamAValue === 'object' && teamAValue !== null
      ? {
          id: teamAId,
          name: teamAName || 'Team A',
          logo: teamAValue.logo || '',
          score: toNumber(teamAValue.score, 0)
        }
      : { id: teamAId, name: teamAName || 'Team A', logo: '', score: 0 };
    const teamBProfile = typeof teamBValue === 'object' && teamBValue !== null
      ? {
          id: teamBId,
          name: teamBName || 'Team B',
          logo: teamBValue.logo || '',
          score: toNumber(teamBValue.score, 0)
        }
      : { id: teamBId, name: teamBName || 'Team B', logo: '', score: 0 };

    const roundsPlayed = toNumber(postmatch.round, 0) || Math.max(...(Array.isArray(postmatch.players) ? postmatch.players.map((p) => toNumber(p?.roundsPlayed ?? p?.rounds, 0)) : [0]), 0);
    const completedRounds = roundsPlayed;
    const rawPlayers = Array.isArray(postmatch.players) ? postmatch.players : [];
    const enrichedPlayers = rawPlayers.map((player, index) => {
      const steamId = player?.steamId || `postmatch_${index}`;
      const regPlayer = players.find((p) => normalizeSteamId(p.steamId) === normalizeSteamId(steamId));
      const side = (player?.side || '').toUpperCase() === 'CT' || (player?.side || '').toUpperCase() === 'T'
        ? player.side.toUpperCase()
        : (isPlayerInTeam(player, { teamId: teamAId, teamName: teamAName, side: 'CT' }) ? 'CT' : 'T');
      const roundStats = {
        killsByRound: Array.isArray(player?.roundStats?.killsByRound) ? player.roundStats.killsByRound : [],
        damageByRound: Array.isArray(player?.roundStats?.damageByRound) ? player.roundStats.damageByRound : [],
        survivedByRound: Array.isArray(player?.roundStats?.survivedByRound) ? player.roundStats.survivedByRound : [],
        kastByRound: Array.isArray(player?.roundStats?.kastByRound) ? player.roundStats.kastByRound : []
      };
      return buildScoreboardOverallPlayer({
        steamId,
        sourcePlayer: player,
        regPlayer,
        teamProfile: side === 'CT' ? teamAProfile : teamBProfile,
        side,
        roundsPlayed,
        completedRounds,
        roundStats,
        baseUrl
      });
    });

    const normalizedPlayers = buildStablePlayerList(sortPlayersBestToWorst(enrichedPlayers).slice(0, 10), 10);
    const meaningfulPlayers = normalizedPlayers.filter((p) => !p.isPlaceholder);

    const rankedTeamAPlayers = sortPlayersBestToWorst(
      meaningfulPlayers.filter((player) =>
        isPlayerInTeam(player, { teamId: teamAId, teamName: teamAName, side: 'CT' })
      )
    );
    const rankedTeamBPlayers = sortPlayersBestToWorst(
      meaningfulPlayers.filter((player) =>
        isPlayerInTeam(player, { teamId: teamBId, teamName: teamBName, side: 'T' })
      )
    );

    const fallbackTeamA = sortPlayersBestToWorst(
      meaningfulPlayers.filter((player) => (player.side || '').toUpperCase() === 'CT')
    );
    const fallbackTeamB = sortPlayersBestToWorst(
      meaningfulPlayers.filter((player) => (player.side || '').toUpperCase() === 'T')
    );

    const teamAPlayers = buildTeamSlotList(rankedTeamAPlayers.length ? rankedTeamAPlayers : fallbackTeamA, 5)
      .map((player, index) => normalizePlayerStatsShape({ ...player, scoreboardRank: index + 1 }, { placeholder: !!player?.isPlaceholder }));
    const teamBPlayers = buildTeamSlotList(rankedTeamBPlayers.length ? rankedTeamBPlayers : fallbackTeamB, 5)
      .map((player, index) => normalizePlayerStatsShape({ ...player, scoreboardRank: index + 1 }, { placeholder: !!player?.isPlaceholder }));

    const rankByKey = new Map();
    teamAPlayers.forEach((player) => {
      const key = normalizeSteamId(player.steamId || player.id);
      if (key) rankByKey.set(key, player.scoreboardRank);
    });
    teamBPlayers.forEach((player) => {
      const key = normalizeSteamId(player.steamId || player.id);
      if (key) rankByKey.set(key, player.scoreboardRank);
    });

    const rankedPostPlayers = normalizedPlayers.map((player) => {
      const key = normalizeSteamId(player.steamId || player.id);
      const teamRank = key ? rankByKey.get(key) : null;
      return normalizePlayerStatsShape({ ...player, scoreboardRank: teamRank ?? player.scoreboardRank ?? null }, { placeholder: !!player?.isPlaceholder });
    });

    const playersTable = buildPlayersTableRows(rankedPostPlayers);
    const teamAPlayersTable = buildPlayersTableRows(teamAPlayers);
    const teamBPlayersTable = buildPlayersTableRows(teamBPlayers);
    const statsDebug = buildStatsDebug({
      players: rankedPostPlayers,
      playersTable,
      rawScoreboardPlayers: null
    });

    const topPlayers = buildOverallTopPlayers(meaningfulPlayers);
    const rankedForMvp = sortPlayersBestToWorst(meaningfulPlayers);

    res.json({
      ...postmatch,
      type: postmatch.type || 'overall_scoreboard',
      players: rankedPostPlayers,
      playersTable,
      teamAPlayers,
      teamBPlayers,
      teamAPlayersTable,
      teamBPlayersTable,
      mvp: rankedForMvp[0] || postmatch.mvp || null,
      topPlayers,
      statAvailability: buildOverallStatAvailability(meaningfulPlayers),
      statsDebug,
      teamStats: postmatch.teamStats || { teamA: null, teamB: null }
    });
  } catch (err) {
    console.error('Error in /api/graphics/postmatch:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

app.get('/api/graphics/player-stats/live', (req, res) => {
  try {
    res.json(buildPlayerStatsPayload('live', req));
  } catch (err) {
    console.error('Error in /api/graphics/player-stats/live:', err);
    res.status(500).json({ mode: 'live', error: err.message, players: [] });
  }
});

app.get('/api/graphics/player-stats/postmatch', (req, res) => {
  try {
    res.json(buildPlayerStatsPayload('postmatch', req));
  } catch (err) {
    console.error('Error in /api/graphics/player-stats/postmatch:', err);
    res.status(500).json({ mode: 'postmatch', error: err.message, players: [] });
  }
});

app.get('/api/graphics/player-stats/live/compact', (req, res) => {
  try {
    res.json(buildPlayerStatsPayload('live', req, { compact: true }));
  } catch (err) {
    console.error('Error in /api/graphics/player-stats/live/compact:', err);
    res.status(500).json({ mode: 'live', error: err.message, players: [], teamAPlayers: [], teamBPlayers: [], topPlayers: {}, mvp: null, updatedAt: '' });
  }
});

app.get('/api/graphics/player-stats/postmatch/compact', (req, res) => {
  try {
    res.json(buildPlayerStatsPayload('postmatch', req, { compact: true }));
  } catch (err) {
    console.error('Error in /api/graphics/player-stats/postmatch/compact:', err);
    res.status(500).json({ mode: 'postmatch', error: err.message, players: [], teamAPlayers: [], teamBPlayers: [], topPlayers: {}, mvp: null, updatedAt: '' });
  }
});

app.get('/api/graphics/player-stats/:matchId', (req, res) => {
  try {
    const { matchId } = req.params;
    const completed = readCompletedMatches();
    const match = Array.isArray(completed) ? completed.find((m) => m.matchId === matchId || m.id === matchId) : null;
    if (!match) {
      return res.status(404).json({ mode: 'postmatch', error: 'Match not found', matchId, players: [] });
    }
    res.json(buildPlayerStatsPayloadFromMatch(match, req));
  } catch (err) {
    console.error('Error in /api/graphics/player-stats/:matchId:', err);
    res.status(500).json({ mode: 'postmatch', error: err.message, players: [] });
  }
});

app.get('/api/graphics/match/:matchId/final', (req, res) => {
  try {
    const { matchId } = req.params;
    const POSTMATCH_FILE = STORAGE_FILES.postmatch;
    
    if (fs.existsSync(POSTMATCH_FILE)) {
      const postmatch = JSON.parse(fs.readFileSync(POSTMATCH_FILE, 'utf8'));
      
      if (postmatch.matchId === matchId) {
        res.json(postmatch);
      } else {
        res.status(404).json({ error: 'Match not found' });
      }
    } else {
      res.status(404).json({ error: 'No postmatch data available' });
    }
  } catch (err) {
    console.error('Error in /api/graphics/match/:matchId/final:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/admin/finalize-match
 * Finalize current live match snapshot into postmatch storage.
 */
app.post('/api/admin/finalize-match', (req, res) => {
  try {
    const requestedMatchId = req.body?.matchId;
    const matchId = requestedMatchId || `match_${Date.now()}`;
    const storagePath = path.join(__dirname, 'storage');

    const finalized = matchFinalization.finalizeMatch(
      matchId,
      scoreboard,
      players,
      teams,
      storagePath,
      {
        roundsHistory
      }
    );

    res.json({
      ok: true,
      matchId,
      postmatch: finalized,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/admin/finalize-match:', err);
    res.status(500).json({
      ok: false,
      error: 'Failed to finalize match',
      message: err.message
    });
  }
});

app.get('/api/graphics/health', (req, res) => {
  try {
    const now = Date.now();
    const liveData = readJsonSafe(STORAGE_FILES.liveMatch, getIdleLiveMatch());
    const postmatchData = readJsonSafe(STORAGE_FILES.postmatch, getIdlePostmatch());
    const hasScoreboardPlayers = Object.keys(scoreboard.players || {}).length;
    const hasPostmatch = !!(postmatchData && postmatchData.status && postmatchData.status !== 'idle');
    const hasLiveMatch =
      !!(liveData && liveData.status && liveData.status !== 'idle') || hasScoreboardPlayers > 0;

    let gsiStatus = 'idle';
    if (lastScoreboardUpdate) {
      const diffSec = (now - new Date(lastScoreboardUpdate).getTime()) / 1000;
      gsiStatus = diffSec <= 30 ? 'connected' : 'idle';
    }

    const storage = {
      postmatch: fs.existsSync(STORAGE_FILES.postmatch) ? 'ok' : 'missing',
      completedMatches: fs.existsSync(STORAGE_FILES.completedMatches) ? 'ok' : 'missing',
      liveMatch: fs.existsSync(STORAGE_FILES.liveMatch) ? 'ok' : 'missing'
    };

    res.json({
      ok: true,
      gsiStatus,
      lastScoreboardUpdate,
      lastPostmatchUpdate: postmatchData?.updatedAt || null,
      scoreboardPlayers: hasScoreboardPlayers,
      postmatchPlayers: Array.isArray(postmatchData?.players) ? postmatchData.players.length : 0,
      hasPostmatch,
      hasLiveMatch,
      storage
    });
  } catch (err) {
    console.error('Error in /api/graphics/health:', err);
    res.status(500).json({
      ok: false,
      gsiStatus: 'error',
      lastScoreboardUpdate,
      lastPostmatchUpdate: null,
      scoreboardPlayers: 0,
      postmatchPlayers: 0,
      hasPostmatch: false,
      hasLiveMatch: false,
      storage: {
        postmatch: 'error',
        completedMatches: 'error',
        liveMatch: 'error'
      },
      message: err.message
    });
  }
});

/**
 * GET /api/graphics/rosters
 * Returns complete rosters with all teams and players
 * Format optimized for GB Next Gen Overlay roster binding
 */
app.get('/api/graphics/rosters', (req, res) => {
  try {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${port}`;
    const baseUrl = `${protocol}://${host}`;

    const normalizedTeams = teams
      .map(team => graphicsUtils.normalizeTeamForGraphics(team, players, baseUrl))
      .filter(t => t !== null);

    const normalizedPlayers = players
      .map(p => {
        const playerTeam = teams.find(t => 
          t.id === p.teamId || 
          (p.teamName && t.name.toLowerCase() === p.teamName.toLowerCase()) ||
          (p.team && t.name.toLowerCase() === p.team.toLowerCase()) ||
          (p.team && t.shortName.toLowerCase() === p.team.toLowerCase())
        );
        return graphicsUtils.normalizePlayerForGraphics(p, playerTeam, baseUrl);
      })
      .filter(p => p !== null);

    res.json({
      mode: 'rosters',
      updatedAt: new Date().toISOString(),
      teamsCount: normalizedTeams.length,
      playersCount: normalizedPlayers.length,
      teams: normalizedTeams,
      players: normalizedPlayers
    });
  } catch (err) {
    console.error('Error in /api/graphics/rosters:', err);
    res.status(500).json({
      ok: false,
      mode: 'rosters',
      error: err.message,
      teamsCount: 0,
      playersCount: 0,
      teams: [],
      players: []
    });
  }
});

/**
 * GET /api/graphics/rosters/compact
 * Compact roster format for simple titling systems
 */
app.get('/api/graphics/rosters/compact', (req, res) => {
  try {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${port}`;
    const baseUrl = `${protocol}://${host}`;

    const compactTeams = teams
      .map(team => {
        const teamPlayers = players
          .filter(p => 
            p.teamId === team.id || 
            (p.teamName && team.name.toLowerCase() === p.teamName.toLowerCase()) ||
            (p.team && team.name.toLowerCase() === p.team.toLowerCase()) ||
            (p.team && team.shortName.toLowerCase() === p.team.toLowerCase())
          )
          .map(p => {
            const firstName = p.firstName || p['First Name'] || null;
            const countryCode = (p.countryCode || p['Country Code'] || p.country || '').toUpperCase() || null;
            const photo = (p.photo || p.avatar || '').startsWith('http') 
              ? (p.photo || p.avatar)
              : (p.photo || p.avatar ? `${baseUrl}${p.photo || p.avatar}` : `${baseUrl}/NoneP.png`);
            return {
              nickname: p.nickname || p.name || '',
              firstName: firstName,
              countryCode: countryCode,
              photo: photo
            };
          });

        const logo = team.logo
          ? (team.logo.startsWith('http') ? team.logo : `${baseUrl}${team.logo}`)
          : `${baseUrl}/logos/none-team.png`;

        return {
          id: team.id,
          name: team.name,
          shortName: team.shortName || team.name?.substring(0, 3).toUpperCase() || '',
          logo: logo,
          players: teamPlayers
        };
      })
      .filter(t => t !== null);

    res.json({
      mode: 'rosters_compact',
      updatedAt: new Date().toISOString(),
      teamsCount: compactTeams.length,
      teams: compactTeams
    });
  } catch (err) {
    console.error('Error in /api/graphics/rosters/compact:', err);
    res.status(500).json({
      ok: false,
      mode: 'rosters_compact',
      error: err.message,
      teams: []
    });
  }
});

/**
 * GET /api/graphics/rosters/:teamId
 * Single team roster with detailed player information
 */
app.get('/api/graphics/rosters/:teamId', (req, res) => {
  try {
    const { teamId } = req.params;
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${port}`;
    const baseUrl = `${protocol}://${host}`;

    const team = teams.find(t => t.id === teamId);
    if (!team) {
      return res.status(404).json({
        ok: false,
        mode: 'team_roster',
        error: 'Team not found',
        team: null
      });
    }

    const normalizedTeam = graphicsUtils.normalizeTeamForGraphics(team, players, baseUrl);

    res.json({
      mode: 'team_roster',
      updatedAt: new Date().toISOString(),
      team: normalizedTeam
    });
  } catch (err) {
    console.error('Error in /api/graphics/rosters/:teamId:', err);
    res.status(500).json({
      ok: false,
      mode: 'team_roster',
      error: err.message,
      team: null
    });
  }
});

// ================================
// === NEW DATA API ENDPOINTS ===
// ================================

/**
 * GET /api/graphics/players
 * Returns all players with full profile data optimized for titling
 */
app.get('/api/graphics/players', (req, res) => {
  try {
    const playerStatsData = readJsonSafe(STORAGE_FILES.playerStats, {});
    const normalizedPlayers = players.map(p => {
      const pStats = playerStatsData[p.steamId] || playerStatsData[p.id] || null;
      const team = teams.find(t => t.id === p.teamId);
      const firstName = p.firstName || p['First Name'] || null;
      const lastName = p.lastName || p['Last Name'] || null;
      const countryCode = (p.countryCode || p['Country Code'] || p.country || '').toUpperCase() || null;
      const fullName = p.fullName || (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || p.name);
      return {
        id: p.id,
        steamId: p.steamId || null,
        nickname: p.nickname || p.name,
        name: p.nickname || p.name,
        firstName: firstName,
        lastName: lastName,
        fullName: fullName,
        country: null,
        countryCode: countryCode,
        role: p.role || '',
        photo: graphicsUtils.resolvePlayerPhoto(p, baseUrl),
        teamId: p.teamId || null,
        teamName: team?.name || null,
        teamLogo: team ? graphicsUtils.resolveLogo(team, baseUrl) : `${baseUrl}/logos/none-team.png`,
        stats: pStats ? {
          matchesPlayed: pStats.matchesPlayed || 0,
          mapsPlayed: pStats.mapsPlayed || 0,
          kills: pStats.kills || 0,
          deaths: pStats.deaths || 0,
          assists: pStats.assists || 0,
          kd: pStats.kd || 0,
          adr: pStats.adr || 0,
          rating: pStats.rating || 0,
          damage: pStats.damage || 0
        } : { matchesPlayed: 0, mapsPlayed: 0, kills: 0, deaths: 0, assists: 0, kd: 0, adr: 0, rating: 0, damage: 0 },
        mapStats: pStats?.mapStats || {},
        lastMatches: Array.isArray(pStats?.lastMatches) ? pStats.lastMatches : []
      };
    });

    res.json({
      mode: 'players',
      updatedAt: new Date().toISOString(),
      count: normalizedPlayers.length,
      players: normalizedPlayers
    });
  } catch (err) {
    console.error('Error in /api/graphics/players:', err);
    res.status(500).json({ mode: 'players', error: err.message, count: 0, players: [] });
  }
});

/**
 * GET /api/graphics/live
 * Alias for /api/graphics/scoreboard â€” live GSI match data
 */
app.get('/api/graphics/live', (req, res) => {
  try {
    const teamCT = scoreboard.map?.team_ct || { name: 'CT', score: 0 };
    const teamT = scoreboard.map?.team_t || { name: 'T', score: 0 };
    const teamAProfile = graphicsUtils.resolveTeamProfileFromGSI(teamCT, 'CT', teams, baseUrl);
    const teamBProfile = graphicsUtils.resolveTeamProfileFromGSI(teamT, 'T', teams, baseUrl);

    const playersData = [];
    let ctCount = 0, tCount = 0;
    for (const steamId in scoreboard.players) {
      const gsiPlayer = scoreboard.players[steamId];
      const side = gsiPlayer.team;
      if (side === 'CT') ctCount++;
      if (side === 'T') tCount++;
      if ((side === 'CT' && ctCount > 5) || (side === 'T' && tCount > 5)) continue;
      const regPlayer = graphicsUtils.resolvePlayerBySteamId(steamId, players);
      const firstName = regPlayer?.firstName || regPlayer?.['First Name'] || null;
      const countryCode = (regPlayer?.countryCode || regPlayer?.['Country Code'] || regPlayer?.country || '').toUpperCase() || null;
      playersData.push({
        id: regPlayer?.id || `temp_${steamId}`,
        steamId,
        name: regPlayer?.name || gsiPlayer.name || 'Unknown',
        nickname: regPlayer?.nickname || gsiPlayer.name || 'Unknown',
        firstName,
        countryCode,
        photo: graphicsUtils.resolvePlayerPhoto(regPlayer, baseUrl),
        teamId: regPlayer?.teamId || null,
        teamName: side === 'CT' ? teamCT.name : teamT.name,
        teamLogo: side === 'CT' ? teamAProfile.logo : teamBProfile.logo,
        side,
        kills: gsiPlayer.match_stats?.kills || 0,
        assists: gsiPlayer.match_stats?.assists || 0,
        deaths: gsiPlayer.match_stats?.deaths || 0,
        adr: parseFloat(getAverageDamage(steamId)),
        damage: gsiPlayer.state?.damage || gsiPlayer.accumulatedDmg || 0,
        kd: graphicsUtils.calculateKD(gsiPlayer.match_stats?.kills || 0, gsiPlayer.match_stats?.deaths || 0),
        isAlive: gsiPlayer.state?.health > 0,
        health: gsiPlayer.state?.health || 0
      });
    }
    playersData.sort((a, b) => b.kills - a.kills);

    res.json({
      mode: 'live',
      updatedAt: new Date().toISOString(),
      matchId: null,
      map: scoreboard.map?.name || null,
      round: scoreboard.map?.round || 0,
      phase: scoreboard.map?.phase || 'unknown',
      teamA: teamAProfile,
      teamB: teamBProfile,
      players: playersData,
      teamAPlayers: playersData.filter(p => p.side === 'CT'),
      teamBPlayers: playersData.filter(p => p.side === 'T'),
      topPlayers: {
        kills: playersData.slice(0, 3),
        adr: [...playersData].sort((a, b) => b.adr - a.adr).slice(0, 3),
        damage: [...playersData].sort((a, b) => b.damage - a.damage).slice(0, 3)
      }
    });
  } catch (err) {
    console.error('Error in /api/graphics/live:', err);
    res.status(500).json({ mode: 'live', error: err.message });
  }
});

/**
 * GET /api/graphics/matches
 * GET /api/graphics/matches/completed
 * GET /api/graphics/matches/upcoming  (always empty until match planning system added)
 * GET /api/graphics/matches/live
 * GET /api/graphics/match/:matchId
 * Returns match history from completedMatches.json
 */
app.get('/api/graphics/matches/upcoming', (req, res) => {
  res.json({ mode: 'matches_upcoming', updatedAt: new Date().toISOString(), matches: [] });
});

app.get('/api/graphics/matches/live', (req, res) => {
  try {
    const liveData = readJsonSafe(STORAGE_FILES.liveMatch, getIdleLiveMatch());
    const hasLive = liveData.status !== 'idle' || Object.keys(scoreboard.players || {}).length > 0;
    res.json({
      mode: 'matches_live',
      updatedAt: new Date().toISOString(),
      hasLive,
      matches: hasLive ? [{ id: liveData.matchId, status: 'live', map: liveData.map || scoreboard.map?.name, round: liveData.round || scoreboard.map?.round }] : []
    });
  } catch (err) {
    res.status(500).json({ mode: 'matches_live', error: err.message, matches: [] });
  }
});

app.get('/api/graphics/matches/completed', (req, res) => {
  try {
    const completed = readJsonSafe(STORAGE_FILES.completedMatches, []);
    res.json({
      mode: 'matches_completed',
      updatedAt: new Date().toISOString(),
      count: completed.length,
      matches: Array.isArray(completed) ? completed : []
    });
  } catch (err) {
    res.status(500).json({ mode: 'matches_completed', error: err.message, count: 0, matches: [] });
  }
});

app.get('/api/graphics/matches', (req, res) => {
  try {
    const completed = readJsonSafe(STORAGE_FILES.completedMatches, []);
    const liveData = readJsonSafe(STORAGE_FILES.liveMatch, getIdleLiveMatch());
    const hasLive = liveData.status !== 'idle' || Object.keys(scoreboard.players || {}).length > 0;

    const completedList = Array.isArray(completed) ? completed : [];
    const liveList = hasLive ? [{ id: liveData.matchId, status: 'live', map: liveData.map || scoreboard.map?.name, round: liveData.round || scoreboard.map?.round }] : [];

    res.json({
      mode: 'matches',
      updatedAt: new Date().toISOString(),
      count: completedList.length + liveList.length,
      matches: [...liveList, ...completedList]
    });
  } catch (err) {
    res.status(500).json({ mode: 'matches', error: err.message, count: 0, matches: [] });
  }
});

app.get('/api/graphics/match/:matchId', (req, res) => {
  try {
    const { matchId } = req.params;
    const completed = readJsonSafe(STORAGE_FILES.completedMatches, []);
    const match = Array.isArray(completed) ? completed.find(m => m.matchId === matchId || m.id === matchId) : null;
    if (!match) return res.status(404).json({ error: 'Match not found', matchId });
    res.json({ mode: 'match', ...match });
  } catch (err) {
    res.status(500).json({ mode: 'match', error: err.message });
  }
});

/**
 * GET /api/graphics/database
 * Full snapshot of all GGBB data â€” main datasource for GB Next Gen Overlay
 */
app.get('/api/graphics/database', (req, res) => {
  try {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${port}`;
    const reqBaseUrl = `${protocol}://${host}`;

    const teamStatsData = readJsonSafe(STORAGE_FILES.teamStats, {});
    const playerStatsData = readJsonSafe(STORAGE_FILES.playerStats, {});
    const mapStatsData = readJsonSafe(STORAGE_FILES.mapStats, {});
    const h2hData = readJsonSafe(STORAGE_FILES.headToHead, {});
    const completedMatches = readJsonSafe(STORAGE_FILES.completedMatches, []);

    // Normalize all teams
    const teamsOut = teams.map(team => graphicsUtils.normalizeTeamForGraphics(team, players, reqBaseUrl));
    // Normalize all players
    const playersOut = players.map(p => {
      const team = teams.find(t => t.id === p.teamId);
      return graphicsUtils.normalizePlayerForGraphics(p, team, reqBaseUrl);
    });
    // Roster format (teams with players inside)
    const rostersOut = teamsOut.map(t => ({
      id: t.id, name: t.name, shortName: t.shortName, tag: t.tag,
      logo: t.logo, countryCode: t.countryCode,
      players: t.players, playersCount: t.playersCount
    }));

    // Assets
    const teamLogos = teams.map(t => ({
      teamId: t.id, teamName: t.name,
      logo: graphicsUtils.resolveLogo(t, reqBaseUrl)
    }));
    const playerPhotos = players.map(p => ({
      playerId: p.id, nickname: p.nickname || p.name,
      photo: graphicsUtils.resolvePlayerPhoto(p, reqBaseUrl)
    }));

    res.json({
      mode: 'database',
      updatedAt: new Date().toISOString(),
      teamsCount: teams.length,
      playersCount: players.length,
      matchesCount: Array.isArray(completedMatches) ? completedMatches.length : 0,
      teams: teamsOut,
      players: playersOut,
      rosters: rostersOut,
      matches: Array.isArray(completedMatches) ? completedMatches : [],
      completedMatches: Array.isArray(completedMatches) ? completedMatches : [],
      stats: {
        teams: teamStatsData,
        players: playerStatsData,
        maps: mapStatsData,
        headToHead: h2hData
      },
      assets: {
        teamLogos,
        playerPhotos,
        fallbacks: {
          playerPhoto: `${reqBaseUrl}/NoneP.png`,
          teamLogo: `${reqBaseUrl}/logos/none-team.png`
        }
      }
    });
  } catch (err) {
    console.error('Error in /api/graphics/database:', err);
    res.status(500).json({ mode: 'database', error: err.message });
  }
});

/**
 * GET /api/graphics/validate
 * Data quality check â€” shows warnings about missing data
 */
app.get('/api/graphics/validate', (req, res) => {
  try {
    const warnings = [];
    const errors = [];
    let ok = true;

    // Teams without logo
    teams.forEach(t => {
      if (!t.logo) warnings.push(`Team "${t.name}" has no logo`);
    });

    // Teams without players
    teams.forEach(t => {
      const count = players.filter(p => p.teamId === t.id).length;
      if (count === 0) warnings.push(`Team "${t.name}" has no players assigned`);
    });

    // Players without photo
    players.forEach(p => {
      const photoVal = p.photo || p.avatar || '';
      if (!photoVal) warnings.push(`Player "${p.nickname || p.name}" has no photo`);
    });

    // Players without SteamID
    players.forEach(p => {
      if (!p.steamId) warnings.push(`Player "${p.nickname || p.name}" has no SteamID`);
    });

    // Players without teamId
    players.forEach(p => {
      if (!p.teamId) warnings.push(`Player "${p.nickname || p.name}" has no team assigned`);
    });

    // Players without firstName/countryCode
    let noFirstName = 0, noCountry = 0;
    players.forEach(p => {
      if (!p.firstName && !p['First Name']) noFirstName++;
      if (!p.countryCode && !p['Country Code'] && !p.country) noCountry++;
    });
    if (noFirstName > 0) warnings.push(`${noFirstName} players missing firstName`);
    if (noCountry > 0) warnings.push(`${noCountry} players missing countryCode`);

    // Live data
    const scoreboardPlayerCount = Object.keys(scoreboard.players || {}).length;
    if (scoreboardPlayerCount > 0 && scoreboardPlayerCount < 10) {
      warnings.push(`Live scoreboard has only ${scoreboardPlayerCount} players (expected 10)`);
    }

    // Postmatch
    const postmatch = readJsonSafe(STORAGE_FILES.postmatch, getIdlePostmatch());
    if (!postmatch || postmatch.status === 'idle') {
      warnings.push('Postmatch is idle (no finalized match)');
    }

    // Storage files
    Object.entries(STORAGE_FILES).forEach(([key, filePath]) => {
      if (!fs.existsSync(filePath)) {
        errors.push(`Storage file missing: ${key} (${filePath})`);
        ok = false;
      }
    });

    if (errors.length > 0) ok = false;

    res.json({
      ok: ok && warnings.length === 0,
      hasWarnings: warnings.length > 0,
      hasErrors: errors.length > 0,
      teamsCount: teams.length,
      playersCount: players.length,
      warnings,
      errors,
      checkedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/graphics/validate:', err);
    res.status(500).json({ ok: false, error: err.message, warnings: [], errors: [] });
  }
});

/**
 * POST /api/admin/rebuild-stats
 * Manually rebuild team/player stats aggregates from completedMatches.json
 */
app.post('/api/admin/rebuild-stats', (req, res) => {
  try {
    const completedMatches = readJsonSafe(STORAGE_FILES.completedMatches, []);
    if (!Array.isArray(completedMatches) || completedMatches.length === 0) {
      return res.json({ ok: true, message: 'No completed matches to aggregate', matchesProcessed: 0 });
    }

    const teamStatsAgg = {};
    const playerStatsAgg = {};
    const mapStatsAgg = {};
    const h2hAgg = {};

    for (const match of completedMatches) {
      if (!match || match.status === 'idle') continue;

      const tAId = match.teamA?.id;
      const tBId = match.teamB?.id;
      const winnerTeamId = match.winnerTeamId;

      // Team stats
      [tAId, tBId].forEach(tid => {
        if (!tid) return;
        if (!teamStatsAgg[tid]) teamStatsAgg[tid] = { matchesPlayed: 0, wins: 0, losses: 0, mapsPlayed: 0, mapsWon: 0, mapsLost: 0, lastMatches: [] };
        teamStatsAgg[tid].matchesPlayed++;
        if (winnerTeamId === tid) teamStatsAgg[tid].wins++;
        else teamStatsAgg[tid].losses++;
        const result = winnerTeamId === tid ? 'W' : 'L';
        teamStatsAgg[tid].lastMatches.unshift({ matchId: match.matchId, result, map: match.map || null, at: match.updatedAt });
        if (teamStatsAgg[tid].lastMatches.length > 10) teamStatsAgg[tid].lastMatches.length = 10;
      });

      // Player stats
      const allPlayers = Array.isArray(match.players) ? match.players : [];
      for (const mp of allPlayers) {
        if (!mp) continue;
        const pid = mp.steamId || mp.id;
        if (!pid) continue;
        if (!playerStatsAgg[pid]) playerStatsAgg[pid] = { matchesPlayed: 0, mapsPlayed: 0, kills: 0, deaths: 0, assists: 0, damage: 0, lastMatches: [] };
        const pAgg = playerStatsAgg[pid];
        pAgg.matchesPlayed++;
        pAgg.mapsPlayed++;
        pAgg.kills += mp.kills || 0;
        pAgg.deaths += mp.deaths || 0;
        pAgg.assists += mp.assists || 0;
        pAgg.damage += mp.damage || 0;
        pAgg.lastMatches.unshift({ matchId: match.matchId, kills: mp.kills, deaths: mp.deaths, adr: mp.adr });
        if (pAgg.lastMatches.length > 10) pAgg.lastMatches.length = 10;
      }

      // H2H
      if (tAId && tBId) {
        const key = `${tAId}_vs_${tBId}`;
        if (!h2hAgg[key]) h2hAgg[key] = { matchesPlayed: 0, wins: 0, losses: 0, recentMatches: [], mapBreakdown: {} };
        h2hAgg[key].matchesPlayed++;
        if (winnerTeamId === tAId) h2hAgg[key].wins++;
        else if (winnerTeamId === tBId) h2hAgg[key].losses++;
        h2hAgg[key].recentMatches.unshift({ matchId: match.matchId, map: match.map, winner: winnerTeamId, at: match.updatedAt });
        if (h2hAgg[key].recentMatches.length > 10) h2hAgg[key].recentMatches.length = 10;
      }
    }

    // Calculate derived stats
    for (const tid in teamStatsAgg) {
      const t = teamStatsAgg[tid];
      t.winRate = t.matchesPlayed > 0 ? parseFloat((t.wins / t.matchesPlayed * 100).toFixed(1)) : 0;
      t.mapWinRate = t.mapsPlayed > 0 ? parseFloat((t.mapsWon / t.mapsPlayed * 100).toFixed(1)) : 0;
    }
    for (const pid in playerStatsAgg) {
      const p = playerStatsAgg[pid];
      p.kd = p.deaths > 0 ? parseFloat((p.kills / p.deaths).toFixed(2)) : p.kills;
      p.adr = p.mapsPlayed > 0 ? parseFloat((p.damage / p.mapsPlayed).toFixed(1)) : 0;
    }

    writeJsonSafe(STORAGE_FILES.teamStats, teamStatsAgg);
    writeJsonSafe(STORAGE_FILES.playerStats, playerStatsAgg);
    writeJsonSafe(STORAGE_FILES.headToHead, h2hAgg);

    res.json({
      ok: true,
      message: 'Stats rebuilt from completed matches',
      matchesProcessed: completedMatches.length,
      teamsAggregated: Object.keys(teamStatsAgg).length,
      playersAggregated: Object.keys(playerStatsAgg).length,
      h2hPairsAggregated: Object.keys(h2hAgg).length,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/admin/rebuild-stats:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/graphics/clear-postmatch', (req, res) => {
  try {
    writeJsonSafe(STORAGE_FILES.postmatch, getIdlePostmatch());
    res.json({ ok: true, message: 'Postmatch data cleared', updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error in /api/admin/graphics/clear-postmatch:', err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post('/api/admin/graphics/clear-live', (req, res) => {
  try {
    writeJsonSafe(STORAGE_FILES.liveMatch, getIdleLiveMatch());
    scoreboard.players = {};
    scoreboard.map = {};
    scoreboard.player = {};
    roundsHistory = [];
    roundsAlive = [];
    currentMatchKey = null;
    resetOverallRoundTracker();
    resetGsiKillTracker();
    lastScoreboardUpdate = null;
    res.json({ ok: true, message: 'Live match cache cleared', updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error in /api/admin/graphics/clear-live:', err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post('/api/admin/graphics/clear-completed-test', (req, res) => {
  try {
    const list = readJsonSafe(STORAGE_FILES.completedMatches, []);
    const safeList = Array.isArray(list) ? list.filter((m) => !isTestLikeMatch(m)) : [];
    const removed = Array.isArray(list) ? list.length - safeList.length : 0;
    writeJsonSafe(STORAGE_FILES.completedMatches, safeList);
    res.json({
      ok: true,
      removed,
      kept: safeList.length,
      message: `Removed ${removed} test/mock matches`,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/admin/graphics/clear-completed-test:', err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ================================
// === END GRAPHICS API ===
// ================================


// ------------------------------
// -ï¿½-ï¿½-+-ï¿½-ï¿½-ï¿½ -ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½-ï¿½ (Express + WebSocket)
// ------------------------------
server.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on ${baseUrl} (HTTP and WebSocket on port ${port})`);
});


