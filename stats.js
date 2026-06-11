/**
 * stats.js — CS2 GSI Statistics System
 * Hooks into existing GSI flow, no changes to scoreboard logic.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, 'stats.json');

// ─── Data structures ────────────────────────────────────────────────────────

function emptyPlayerStats() {
  return {
    // Cumulative match stats
    kills: 0, deaths: 0, assists: 0,
    headshots: 0,
    damage: 0,
    rounds: 0,
    kastRounds: 0,
    mvps: 0,
    score: 0,
    // Combat detail
    firstKills:  0,   // entry/opening kills (first kill of round for team)
    firstDeaths: 0,   // first to die per round per team
    threeKills:  0,   // rounds with 3 kills
    fourKills:   0,   // rounds with 4 kills
    fiveKills:   0,   // aces
    bombPlants:  0,
    bombDefuses: 0,
    // Per-round scratch (reset each round)
    _roundKills: 0, _roundAssists: 0, _survived: false, _traded: false,
    _lastRoundSeen:  -1,
    _maxRoundKills:  0,
    _prevRoundKills: 0,
    _prevHealth:   100,
    _team: '',
    _name: '',
  };
}

function emptyTeamStats() {
  return {
    name: '',
    logo: null,
    roundsWon: 0,
    roundsLost: 0,
  };
}

/**
 * GalaxyRating ≈ HLTV Rating 2.0 inspired formula.
 * Requires: kpr, dpr, kast (0‒1), adr, impact
 *   impact = 2.13*kpr + 0.42*(adr/100) - 0.41
 *   rating = 0.0073*kast + 0.3591*kpr - 0.5329*dpr + 0.2372*impact + 0.0032*adr + 0.1587
 */
function calcGalaxyRating({ kills, deaths, assists, damage, kastRounds, rounds }) {
  if (rounds <= 0) return 0;
  const kpr    = kills   / rounds;
  const dpr    = deaths  / rounds;
  const kast   = kastRounds / rounds;              // 0‒1
  const adr    = damage  / rounds;
  const impact = 2.13 * kpr + 0.42 * (adr / 100) - 0.41;
  const rating = 0.0073 * kast * 100
               + 0.3591 * kpr
               - 0.5329 * dpr
               + 0.2372 * impact
               + 0.0032 * adr
               + 0.1587;
  return Math.max(0, parseFloat(rating.toFixed(3)));
}

// ─── Persistent data ─────────────────────────────────────────────────────────

let statsData = {
  global: {
    players: {},   // steamId → { name, photo, teamId, ...accumulated counters, matchesPlayed }
    teams:   {},   // teamName (lower) → { name, logo, matchesPlayed, matchesWon, roundsWon, roundsLost, ... }
  },
  matchHistory: [],  // array of finished match snapshots
};

function loadStats() {
  if (fs.existsSync(STATS_FILE)) {
    try {
      statsData = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      // ensure shape
      statsData.global         = statsData.global         || { players: {}, teams: {}, maps: {} };
      statsData.global.players = statsData.global.players || {};
      statsData.global.teams   = statsData.global.teams   || {};
      statsData.global.maps    = statsData.global.maps    || {};
      statsData.matchHistory   = statsData.matchHistory   || [];
    } catch (e) {
      console.error('[stats] Failed to load stats.json:', e.message);
    }
  }
}

function saveStats() {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(statsData, null, 2), 'utf8');
  } catch (e) {
    console.error('[stats] Failed to save stats.json:', e.message);
  }
}

loadStats();

// ─── Current match state ─────────────────────────────────────────────────────

let currentMatch = null;  // null = no match in progress

function freshMatch(mapName, teamCT, teamT) {
  return {
    mapName,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    teamCT: { name: teamCT?.name || 'CT', logo: null, score: 0 },
    teamT:  { name: teamT?.name  || 'T',  logo: null, score: 0 },
    players: {},
    roundCount: 0,
    roundOutcomes: {},   // roundNum → outcome code string
    _lastRoundCount: 0,
    _prevPhase: null,
    _ctEntryDone:      false,
    _tEntryDone:       false,
    _ctFirstDeathDone: false,
    _tFirstDeathDone:  false,
    _prevBombState: '',
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolvePlayer(steamId, gsiPlayerObj, playersDb) {
  const db = playersDb.find(p => p.steamId && p.steamId.toLowerCase() === steamId.toLowerCase());
  return db || null;
}

function resolveTeamLogo(teamName, teamsDb) {
  if (!teamName) return null;
  const t = teamsDb.find(t => t.name.toLowerCase() === teamName.toLowerCase());
  return t ? t.logo : null;
}

// ─── Main update hook ────────────────────────────────────────────────────────

/**
 * Call this from server.js AFTER the scoreboard has been updated.
 * @param {object} gsiData   - raw GSI POST body
 * @param {Array}  playersDb - players array from data.json
 * @param {Array}  teamsDb   - teams array from data.json
 */
function onGsiUpdate(gsiData, playersDb, teamsDb) {
  try {
    _processGsi(gsiData, playersDb, teamsDb);
  } catch (e) {
    console.error('[stats] onGsiUpdate error:', e.message);
  }
}

function _processGsi(data, playersDb, teamsDb) {
  const map = data.map || {};
  const mapName   = map.name  || '';
  const mapPhase  = map.phase || '';  // 'warmup' | 'live' | 'intermission' | 'gameover'
  const teamCT    = map.team_ct || {};
  const teamT     = map.team_t  || {};
  const scoreCT   = teamCT.score || 0;
  const scoreT    = teamT.score  || 0;
  const allplayers = data.allplayers || {};
  const roundWins  = map.round_wins  || {};
  const roundCount = Object.keys(roundWins).length;

  console.log(`[stats] GSI: map=${mapName || '(none)'} phase=${mapPhase || '(none)'} players=${Object.keys(allplayers).length} roundCount=${roundCount} currentMatch=${currentMatch ? currentMatch.mapName : 'null'}`);

  // ── 1. Detect new match / map change ─────────────────────────────────────
  if (!currentMatch || currentMatch.mapName !== mapName) {
    if (currentMatch && currentMatch.mapName) {
      _finalizeMatch(currentMatch, playersDb, teamsDb, 'map_change');
    }
    // Only start tracking when the match is actually live (not warmup / no map)
    if (mapName && mapPhase === 'live' || mapName && mapPhase === 'intermission') {
      currentMatch = freshMatch(mapName, teamCT, teamT);
      console.log(`[stats] New match started: ${mapName}`);
    } else {
      currentMatch = null;
      return;
    }
  }

  if (mapPhase === 'gameover' && currentMatch._prevPhase !== 'gameover') {
    _finalizeMatch(currentMatch, playersDb, teamsDb, 'gameover');
    currentMatch._prevPhase = 'gameover';
    return;
  }
  currentMatch._prevPhase = mapPhase;

  if (mapPhase === 'warmup' || mapPhase === 'gameover') return;

  // ── 2. Update team scores & logos ─────────────────────────────────────────
  currentMatch.teamCT.score = scoreCT;
  currentMatch.teamT.score  = scoreT;
  currentMatch.teamCT.name  = teamCT.name || currentMatch.teamCT.name;
  currentMatch.teamT.name   = teamT.name  || currentMatch.teamT.name;
  if (!currentMatch.teamCT.logo) currentMatch.teamCT.logo = resolveTeamLogo(currentMatch.teamCT.name, teamsDb);
  if (!currentMatch.teamT.logo)  currentMatch.teamT.logo  = resolveTeamLogo(currentMatch.teamT.name,  teamsDb);

  // ── 3. Track round outcomes ────────────────────────────────────────────────
  for (const rk in roundWins) {
    const rNum = parseInt(rk);
    if (!currentMatch.roundOutcomes[rNum]) {
      currentMatch.roundOutcomes[rNum] = roundWins[rk];
    }
  }

  // ── 4. Detect new round ────────────────────────────────────────────────────
  const newRound = roundCount > currentMatch._lastRoundCount;
  if (newRound) {
    currentMatch.roundCount      = roundCount;
    currentMatch._lastRoundCount = roundCount;
    _commitRoundKast(currentMatch);
    // Reset per-round entry kill / first death flags
    currentMatch._ctEntryDone      = false;
    currentMatch._tEntryDone       = false;
    currentMatch._ctFirstDeathDone = false;
    currentMatch._tFirstDeathDone  = false;
  }

  // ── 5. Bomb events ─────────────────────────────────────────────────────────
  const bomb      = data.bomb || {};
  const bombState = bomb.state || '';
  if (bombState && bombState !== currentMatch._prevBombState) {
    const bp = bomb.player ? String(bomb.player) : null;
    if (bombState === 'planted' && bp && currentMatch.players[bp]) {
      currentMatch.players[bp].bombPlants = (currentMatch.players[bp].bombPlants || 0) + 1;
    } else if (bombState === 'defused' && bp && currentMatch.players[bp]) {
      currentMatch.players[bp].bombDefuses = (currentMatch.players[bp].bombDefuses || 0) + 1;
    }
    currentMatch._prevBombState = bombState;
  }

  // ── 6. Update per-player stats ────────────────────────────────────────────
  for (const steamId in allplayers) {
    const gp = allplayers[steamId];
    if (!currentMatch.players[steamId]) {
      currentMatch.players[steamId] = emptyPlayerStats();
    }
    const ps = currentMatch.players[steamId];
    const ms = gp.match_stats || {};

    // Team and name from GSI
    if (gp.team) ps._team = gp.team;
    if (gp.name) ps._name = gp.name;

    // Direct match_stats (cumulative) — explicit check avoids || bug with 0
    if (ms.kills     !== undefined) ps.kills     = ms.kills;
    if (ms.deaths    !== undefined) ps.deaths    = ms.deaths;
    if (ms.assists   !== undefined) ps.assists   = ms.assists;
    if (ms.headshots !== undefined) ps.headshots = ms.headshots;
    if (ms.mvps      !== undefined) ps.mvps      = ms.mvps;
    if (ms.score     !== undefined) ps.score     = ms.score;

    // Damage via round_totaldmg
    const roundDmg = (gp.state && gp.state.round_totaldmg) || 0;
    if (roundDmg === 0 && (ps._prevRoundDmg || 0) > 0) {
      ps.damage += ps._prevRoundDmg;
    }
    ps._prevRoundDmg = roundDmg;

    // Rounds played
    if (newRound && ps._lastRoundSeen < roundCount) {
      ps.rounds = Math.max(ps.rounds, roundCount);
      ps._lastRoundSeen = roundCount;
    }

    // Per-round kill count for multi-kill and entry kill detection
    const currRoundKills = (gp.state && gp.state.round_kills != null) ? gp.state.round_kills : -1;
    if (currRoundKills >= 0) {
      if (currRoundKills > (ps._maxRoundKills || 0)) {
        ps._maxRoundKills = currRoundKills;
      }
      // Entry kill: first kill event this round for this player's team
      if (currRoundKills > 0 && (ps._prevRoundKills || 0) === 0) {
        const team = gp.team || ps._team;
        if (team === 'CT' && !currentMatch._ctEntryDone) {
          ps.firstKills = (ps.firstKills || 0) + 1;
          currentMatch._ctEntryDone = true;
        } else if (team === 'T' && !currentMatch._tEntryDone) {
          ps.firstKills = (ps.firstKills || 0) + 1;
          currentMatch._tEntryDone = true;
        }
      }
      ps._prevRoundKills = currRoundKills;
    }

    // First death detection (health >0 → 0 transition)
    const health = gp.state ? gp.state.health : undefined;
    if (health !== undefined) {
      const prevHealth = ps._prevHealth != null ? ps._prevHealth : 100;
      if (health === 0 && prevHealth > 0) {
        const team = gp.team || ps._team;
        if (team === 'CT' && !currentMatch._ctFirstDeathDone) {
          ps.firstDeaths = (ps.firstDeaths || 0) + 1;
          currentMatch._ctFirstDeathDone = true;
        } else if (team === 'T' && !currentMatch._tFirstDeathDone) {
          ps.firstDeaths = (ps.firstDeaths || 0) + 1;
          currentMatch._tFirstDeathDone = true;
        }
      }
      ps._prevHealth = health;
    }

    // KAST scratch
    if ((ms.kills || 0) > ps._roundKills) ps._roundKills = ms.kills || 0;
    if ((ms.assists || 0) > ps._roundAssists) ps._roundAssists = ms.assists || 0;
    if (gp.state && gp.state.health > 0) ps._survived = true;
  }
}

function _commitRoundKast(match) {
  for (const steamId in match.players) {
    const ps = match.players[steamId];
    const hadKill   = ps._roundKills   > 0;
    const hadAssist = ps._roundAssists > 0;
    const survived  = ps._survived;
    const traded    = ps._traded;
    if (hadKill || hadAssist || survived || traded) ps.kastRounds++;
    // Multi-kill stats from max round_kills seen this round
    const rk = ps._maxRoundKills || 0;
    if (rk >= 5)       ps.fiveKills  = (ps.fiveKills  || 0) + 1;
    else if (rk === 4) ps.fourKills  = (ps.fourKills  || 0) + 1;
    else if (rk === 3) ps.threeKills = (ps.threeKills || 0) + 1;
    // Reset scratch
    ps._roundKills     = 0;
    ps._roundAssists   = 0;
    ps._survived       = false;
    ps._traded         = false;
    ps._maxRoundKills  = 0;
    ps._prevRoundKills = 0;
  }
}

// ─── Finalize match ──────────────────────────────────────────────────────────

function _finalizeMatch(match, playersDb, teamsDb, reason) {
  if (!match || !match.mapName) return;
  console.log(`[stats] Finalizing match on ${match.mapName} (${reason})`);

  match.finishedAt = new Date().toISOString();

  // Determine winner
  const ctScore = match.teamCT.score;
  const tScore  = match.teamT.score;
  let winner = null;
  if (ctScore > tScore) winner = match.teamCT.name;
  else if (tScore > ctScore) winner = match.teamT.name;

  // Build snapshot for match history
  const snapshot = {
    id: Date.now().toString(),
    mapName: match.mapName,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
    teamCT: { ...match.teamCT },
    teamT:  { ...match.teamT  },
    winner,
    roundCount: match.roundCount,
    roundOutcomes: { ...match.roundOutcomes },
    players: {},
  };

  const rounds = Math.max(match.roundCount, 1);
  for (const steamId in match.players) {
    const ps  = match.players[steamId];
    const db  = resolvePlayer(steamId, null, playersDb);
    const dmg = ps.damage + (ps._prevRoundDmg || 0);
    const r   = ps.rounds || rounds;
    const sp = {
      steamId,
      name:    db?.name   || ps._name || '',
      photo:   db?.photo  || null,
      teamId:  db?.teamId || null,
      _team:   ps._team   || '',
      kills:   ps.kills,
      deaths:  ps.deaths,
      assists: ps.assists,
      headshots: ps.headshots,
      damage:  dmg,
      rounds:  r,
      kastRounds: ps.kastRounds,
      mvps:        ps.mvps        || 0,
      score:       ps.score       || 0,
      firstKills:  ps.firstKills  || 0,
      firstDeaths: ps.firstDeaths || 0,
      threeKills:  ps.threeKills  || 0,
      fourKills:   ps.fourKills   || 0,
      fiveKills:   ps.fiveKills   || 0,
      bombPlants:  ps.bombPlants  || 0,
      bombDefuses: ps.bombDefuses || 0,
      adr:    r > 0 ? parseFloat((dmg / r).toFixed(1)) : 0,
      kd:     ps.deaths > 0 ? parseFloat((ps.kills / ps.deaths).toFixed(2)) : parseFloat(ps.kills.toFixed(2)),
      kpr:    r > 0 ? parseFloat((ps.kills  / r).toFixed(3)) : 0,
      dpr:    r > 0 ? parseFloat((ps.deaths / r).toFixed(3)) : 0,
      kast:   r > 0 ? parseFloat(((ps.kastRounds / r) * 100).toFixed(1)) : 0,
      hsRate: ps.kills > 0 ? parseFloat(((ps.headshots / ps.kills) * 100).toFixed(1)) : 0,
    };
    sp.galaxyRating = calcGalaxyRating({ kills: sp.kills, deaths: sp.deaths, assists: sp.assists, damage: dmg, kastRounds: ps.kastRounds, rounds: r });
    snapshot.players[steamId] = sp;
  }

  statsData.matchHistory.unshift(snapshot);
  if (statsData.matchHistory.length > 200) statsData.matchHistory.pop();

  // ── Merge into global player stats ────────────────────────────────────────
  for (const steamId in snapshot.players) {
    const sp = snapshot.players[steamId];
    if (!statsData.global.players[steamId]) {
      statsData.global.players[steamId] = {
        steamId, name: sp.name, photo: sp.photo, teamId: sp.teamId,
        kills: 0, deaths: 0, assists: 0, headshots: 0,
        damage: 0, rounds: 0, kastRounds: 0, matchesPlayed: 0,
        mvps: 0, firstKills: 0, firstDeaths: 0,
        threeKills: 0, fourKills: 0, fiveKills: 0,
        bombPlants: 0, bombDefuses: 0,
      };
    }
    const g = statsData.global.players[steamId];
    if (sp.name)   g.name   = sp.name;
    if (sp.photo)  g.photo  = sp.photo;
    if (sp.teamId) g.teamId = sp.teamId;
    g.kills       += sp.kills;
    g.deaths      += sp.deaths;
    g.assists     += sp.assists;
    g.headshots   += sp.headshots;
    g.damage      += sp.damage;
    g.rounds      += sp.rounds;
    g.kastRounds  += sp.kastRounds;
    g.matchesPlayed++;
    g.mvps        = (g.mvps        || 0) + (sp.mvps        || 0);
    g.firstKills  = (g.firstKills  || 0) + (sp.firstKills  || 0);
    g.firstDeaths = (g.firstDeaths || 0) + (sp.firstDeaths || 0);
    g.threeKills  = (g.threeKills  || 0) + (sp.threeKills  || 0);
    g.fourKills   = (g.fourKills   || 0) + (sp.fourKills   || 0);
    g.fiveKills   = (g.fiveKills   || 0) + (sp.fiveKills   || 0);
    g.bombPlants  = (g.bombPlants  || 0) + (sp.bombPlants  || 0);
    g.bombDefuses = (g.bombDefuses || 0) + (sp.bombDefuses || 0);
  }

  // ── Global team stats ──────────────────────────────────────────────────────
  const teamsInMatch = [
    { info: match.teamCT, isWinner: match.teamCT.name === winner, score: ctScore, oppScore: tScore },
    { info: match.teamT,  isWinner: match.teamT.name  === winner, score: tScore,  oppScore: ctScore },
  ];
  for (const { info, isWinner, score, oppScore } of teamsInMatch) {
    const key = info.name.toLowerCase();
    if (!key) continue;
    if (!statsData.global.teams[key]) {
      statsData.global.teams[key] = {
        name: info.name, logo: info.logo,
        matchesPlayed: 0, matchesWon: 0,
        roundsWon: 0, roundsLost: 0,
        mapStats: {},
      };
    }
    const gt = statsData.global.teams[key];
    if (info.logo && !gt.logo) gt.logo = info.logo;
    if (!gt.mapStats) gt.mapStats = {};
    gt.matchesPlayed++;
    if (isWinner) gt.matchesWon++;
    gt.roundsWon  += score;
    gt.roundsLost += oppScore;
    const mk = match.mapName.toLowerCase();
    if (!gt.mapStats[mk]) gt.mapStats[mk] = { played: 0, won: 0 };
    gt.mapStats[mk].played++;
    if (isWinner) gt.mapStats[mk].won++;
  }

  // ── Global map stats ───────────────────────────────────────────────────────
  if (!statsData.global.maps) statsData.global.maps = {};
  const mapKey = match.mapName.toLowerCase();
  if (!statsData.global.maps[mapKey]) {
    statsData.global.maps[mapKey] = {
      name: match.mapName,
      matchCount: 0, ctWins: 0, tWins: 0, draws: 0,
      totalRounds: 0,
      roundOutcomes: {
        ct_win_elimination: 0, ct_win_time: 0, ct_win_defuse: 0,
        t_win_elimination: 0,  t_win_bomb: 0,
      },
    };
  }
  const gm = statsData.global.maps[mapKey];
  if (!gm.roundOutcomes) gm.roundOutcomes = { ct_win_elimination: 0, ct_win_time: 0, ct_win_defuse: 0, t_win_elimination: 0, t_win_bomb: 0 };
  gm.matchCount++;
  if (winner === match.teamCT.name) gm.ctWins++;
  else if (winner === match.teamT.name) gm.tWins++;
  else gm.draws = (gm.draws || 0) + 1;
  gm.totalRounds += match.roundCount;
  for (const rNum in match.roundOutcomes) {
    const outcome = match.roundOutcomes[rNum];
    if (gm.roundOutcomes[outcome] !== undefined) gm.roundOutcomes[outcome]++;
  }

  saveStats();
  currentMatch = null;
}

// ─── Computed views ──────────────────────────────────────────────────────────

function getCurrentMatchStats() {
  if (!currentMatch) return null;
  const rounds = Math.max(currentMatch.roundCount, 1);
  const players = {};
  for (const steamId in currentMatch.players) {
    const ps  = currentMatch.players[steamId];
    const dmg = ps.damage + (ps._prevRoundDmg || 0);
    const r   = Math.max(ps.rounds || 0, 1);
    players[steamId] = {
      steamId,
      name:    ps._name || '',
      photo:   null,
      _team:   ps._team || '',
      kills:   ps.kills,   deaths:  ps.deaths,  assists: ps.assists,
      headshots: ps.headshots, damage: dmg, rounds: r,
      kastRounds: ps.kastRounds,
      mvps:        ps.mvps        || 0,
      score:       ps.score       || 0,
      firstKills:  ps.firstKills  || 0,
      firstDeaths: ps.firstDeaths || 0,
      threeKills:  ps.threeKills  || 0,
      fourKills:   ps.fourKills   || 0,
      fiveKills:   ps.fiveKills   || 0,
      bombPlants:  ps.bombPlants  || 0,
      bombDefuses: ps.bombDefuses || 0,
      adr:  r > 0 ? parseFloat((dmg / r).toFixed(1)) : 0,
      kd:   ps.deaths > 0 ? parseFloat((ps.kills / ps.deaths).toFixed(2)) : parseFloat(ps.kills.toFixed(2)),
      kpr:  r > 0 ? parseFloat((ps.kills  / r).toFixed(3)) : 0,
      dpr:  r > 0 ? parseFloat((ps.deaths / r).toFixed(3)) : 0,
      kast: r > 0 ? parseFloat(((ps.kastRounds / r) * 100).toFixed(1)) : 0,
      hsRate: ps.kills > 0 ? parseFloat(((ps.headshots / ps.kills) * 100).toFixed(1)) : 0,
      galaxyRating: calcGalaxyRating({ kills: ps.kills, deaths: ps.deaths, assists: ps.assists, damage: dmg, kastRounds: ps.kastRounds, rounds: r }),
    };
  }
  return {
    mapName: currentMatch.mapName,
    startedAt: currentMatch.startedAt,
    teamCT: currentMatch.teamCT,
    teamT:  currentMatch.teamT,
    roundCount: currentMatch.roundCount,
    players,
  };
}

function getGlobalPlayerRatings(playersDb) {
  return Object.values(statsData.global.players)
    .map(g => {
      const r   = g.rounds || 1;
      const db  = playersDb.find(p => p.steamId && p.steamId.toLowerCase() === g.steamId.toLowerCase());
      const adr  = parseFloat((g.damage / r).toFixed(1));
      const kpr  = parseFloat((g.kills  / r).toFixed(3));
      const dpr  = parseFloat((g.deaths / r).toFixed(3));
      const kast = parseFloat(((g.kastRounds / r) * 100).toFixed(1));
      return {
        steamId: g.steamId,
        name:   db?.name  || g.name  || g.steamId,
        photo:  db?.photo || g.photo || null,
        teamId: db?.teamId || g.teamId || null,
        matchesPlayed: g.matchesPlayed,
        kills: g.kills, deaths: g.deaths, assists: g.assists,
        headshots: g.headshots, rounds: r,
        mvps:        g.mvps        || 0,
        firstKills:  g.firstKills  || 0,
        firstDeaths: g.firstDeaths || 0,
        threeKills:  g.threeKills  || 0,
        fourKills:   g.fourKills   || 0,
        fiveKills:   g.fiveKills   || 0,
        bombPlants:  g.bombPlants  || 0,
        bombDefuses: g.bombDefuses || 0,
        adr, kpr, dpr, kast,
        kd: g.deaths > 0 ? parseFloat((g.kills / g.deaths).toFixed(2)) : g.kills,
        hsRate: g.kills > 0 ? parseFloat(((g.headshots / g.kills) * 100).toFixed(1)) : 0,
        galaxyRating: calcGalaxyRating(g),
      };
    })
    .sort((a, b) => b.galaxyRating - a.galaxyRating);
}

function getGlobalTeamRatings(teamsDb) {
  return Object.values(statsData.global.teams)
    .map(t => {
      const db = teamsDb.find(td => td.name.toLowerCase() === t.name.toLowerCase());
      const totalRounds = t.roundsWon + t.roundsLost;
      return {
        name: t.name,
        logo: db?.logo || t.logo || null,
        matchesPlayed: t.matchesPlayed,
        matchesWon:    t.matchesWon,
        roundsWon:  t.roundsWon,
        roundsLost: t.roundsLost,
        winRate:      t.matchesPlayed > 0 ? parseFloat(((t.matchesWon / t.matchesPlayed) * 100).toFixed(1)) : 0,
        roundWinRate: totalRounds     > 0 ? parseFloat(((t.roundsWon  / totalRounds)    * 100).toFixed(1)) : 0,
        mapStats: t.mapStats || {},
      };
    })
    .sort((a, b) => b.winRate - a.winRate || b.roundWinRate - a.roundWinRate);
}

function getMapStats() {
  return Object.values(statsData.global.maps || {})
    .map(m => ({
      name:        m.name,
      displayName: m.name.replace('de_', '').toUpperCase(),
      matchCount:  m.matchCount,
      ctWins:      m.ctWins  || 0,
      tWins:       m.tWins   || 0,
      draws:       m.draws   || 0,
      ctWinRate:   m.matchCount > 0 ? parseFloat(((m.ctWins / m.matchCount) * 100).toFixed(1)) : 0,
      tWinRate:    m.matchCount > 0 ? parseFloat(((m.tWins  / m.matchCount) * 100).toFixed(1)) : 0,
      avgRounds:   m.matchCount > 0 ? parseFloat((m.totalRounds / m.matchCount).toFixed(1)) : 0,
      totalRounds: m.totalRounds || 0,
      roundOutcomes: m.roundOutcomes || {},
    }))
    .sort((a, b) => b.matchCount - a.matchCount);
}

// ─── Delete match from history ──────────────────────────────────────────────

function deleteMatch(id) {
  const idx = statsData.matchHistory.findIndex(m => m.id === id);
  if (idx === -1) return false;
  statsData.matchHistory.splice(idx, 1);
  // Rebuild global stats from scratch
  statsData.global.players = {};
  statsData.global.teams   = {};
  statsData.global.maps    = {};
  for (const m of statsData.matchHistory) {
    _mergeSnapshotToGlobal(m);
  }
  saveStats();
  return true;
}

function _mergeSnapshotToGlobal(snapshot) {
  const ctScore = snapshot.teamCT?.score || 0;
  const tScore  = snapshot.teamT?.score  || 0;
  const winner  = snapshot.winner;
  for (const steamId in snapshot.players) {
    const sp = snapshot.players[steamId];
    if (!statsData.global.players[steamId]) {
      statsData.global.players[steamId] = {
        steamId, name: sp.name, photo: sp.photo, teamId: sp.teamId,
        kills: 0, deaths: 0, assists: 0, headshots: 0,
        damage: 0, rounds: 0, kastRounds: 0, matchesPlayed: 0,
        mvps: 0, firstKills: 0, firstDeaths: 0,
        threeKills: 0, fourKills: 0, fiveKills: 0,
        bombPlants: 0, bombDefuses: 0,
      };
    }
    const g = statsData.global.players[steamId];
    if (sp.name)   g.name   = sp.name;
    if (sp.photo)  g.photo  = sp.photo;
    if (sp.teamId) g.teamId = sp.teamId;
    g.kills       += sp.kills       || 0;
    g.deaths      += sp.deaths      || 0;
    g.assists     += sp.assists     || 0;
    g.headshots   += sp.headshots   || 0;
    g.damage      += sp.damage      || 0;
    g.rounds      += sp.rounds      || 0;
    g.kastRounds  += sp.kastRounds  || 0;
    g.matchesPlayed++;
    g.mvps        += sp.mvps        || 0;
    g.firstKills  += sp.firstKills  || 0;
    g.firstDeaths += sp.firstDeaths || 0;
    g.threeKills  += sp.threeKills  || 0;
    g.fourKills   += sp.fourKills   || 0;
    g.fiveKills   += sp.fiveKills   || 0;
    g.bombPlants  += sp.bombPlants  || 0;
    g.bombDefuses += sp.bombDefuses || 0;
  }
  const teamsInMatch = [
    { info: snapshot.teamCT, isWinner: snapshot.teamCT?.name === winner, score: ctScore, oppScore: tScore },
    { info: snapshot.teamT,  isWinner: snapshot.teamT?.name  === winner, score: tScore,  oppScore: ctScore },
  ];
  for (const { info, isWinner, score, oppScore } of teamsInMatch) {
    const key = info?.name?.toLowerCase();
    if (!key) continue;
    if (!statsData.global.teams[key]) {
      statsData.global.teams[key] = { name: info.name, logo: info.logo, matchesPlayed: 0, matchesWon: 0, roundsWon: 0, roundsLost: 0, mapStats: {} };
    }
    const gt = statsData.global.teams[key];
    if (info.logo && !gt.logo) gt.logo = info.logo;
    if (!gt.mapStats) gt.mapStats = {};
    gt.matchesPlayed++;
    if (isWinner) gt.matchesWon++;
    gt.roundsWon  += score;
    gt.roundsLost += oppScore;
    const mk = snapshot.mapName?.toLowerCase();
    if (mk) {
      if (!gt.mapStats[mk]) gt.mapStats[mk] = { played: 0, won: 0 };
      gt.mapStats[mk].played++;
      if (isWinner) gt.mapStats[mk].won++;
    }
  }
  if (!statsData.global.maps) statsData.global.maps = {};
  const mapKey = snapshot.mapName?.toLowerCase();
  if (mapKey) {
    if (!statsData.global.maps[mapKey]) {
      statsData.global.maps[mapKey] = { name: snapshot.mapName, matchCount: 0, ctWins: 0, tWins: 0, draws: 0, totalRounds: 0,
        roundOutcomes: { ct_win_elimination: 0, ct_win_time: 0, ct_win_defuse: 0, t_win_elimination: 0, t_win_bomb: 0 } };
    }
    const gm = statsData.global.maps[mapKey];
    gm.matchCount++;
    if (winner === snapshot.teamCT?.name) gm.ctWins++;
    else if (winner === snapshot.teamT?.name) gm.tWins++;
    else gm.draws = (gm.draws || 0) + 1;
    gm.totalRounds += snapshot.roundCount || 0;
    for (const rNum in (snapshot.roundOutcomes || {})) {
      const outcome = snapshot.roundOutcomes[rNum];
      if (gm.roundOutcomes[outcome] !== undefined) gm.roundOutcomes[outcome]++;
    }
  }
}

// ─── Per-entity getters ───────────────────────────────────────────────────────

function getPlayerStats(steamId, playersDb) {
  const actualKey = Object.keys(statsData.global.players).find(k => k.toLowerCase() === steamId.toLowerCase()) || steamId;
  const g  = statsData.global.players[actualKey];
  const db = playersDb.find(p => p.steamId && p.steamId.toLowerCase() === steamId.toLowerCase());
  if (!g && !db) return null;

  const r = Math.max(g?.rounds || 0, 1);

  // Per-map aggregation from match history
  const matchHistory = statsData.matchHistory.filter(m => m.players && (m.players[actualKey] || m.players[steamId]));
  const mapRaw = {};
  matchHistory.forEach(m => {
    const p = m.players[actualKey] || m.players[steamId];
    if (!p) return;
    const mk = (m.mapName || 'unknown').toLowerCase();
    if (!mapRaw[mk]) mapRaw[mk] = { map: m.mapName, matches: 0, wins: 0, kills: 0, deaths: 0, assists: 0, damage: 0, rounds: 0, kastRounds: 0, headshots: 0, mvps: 0, threeKills: 0, fourKills: 0, fiveKills: 0 };
    const ms = mapRaw[mk];
    ms.matches++;
    ms.kills      += p.kills      || 0;
    ms.deaths     += p.deaths     || 0;
    ms.assists    += p.assists    || 0;
    ms.damage     += p.damage     || 0;
    ms.rounds     += p.rounds     || 0;
    ms.kastRounds += p.kastRounds || 0;
    ms.headshots  += p.headshots  || 0;
    ms.mvps       += p.mvps       || 0;
    ms.threeKills += p.threeKills || 0;
    ms.fourKills  += p.fourKills  || 0;
    ms.fiveKills  += p.fiveKills  || 0;
    if (m.winner && p._team) {
      const playerTeam = p._team === 'CT' ? m.teamCT?.name : m.teamT?.name;
      if (playerTeam && playerTeam === m.winner) ms.wins++;
    }
  });

  const mapStats = Object.values(mapRaw).map(ms => {
    const rr = Math.max(ms.rounds, 1);
    return {
      map: ms.map,
      displayName: (ms.map || '').replace('de_', '').toUpperCase(),
      matches: ms.matches, wins: ms.wins,
      winRate: ms.matches > 0 ? parseFloat(((ms.wins / ms.matches) * 100).toFixed(1)) : 0,
      kills: ms.kills, deaths: ms.deaths, assists: ms.assists,
      headshots: ms.headshots, mvps: ms.mvps,
      threeKills: ms.threeKills, fourKills: ms.fourKills, fiveKills: ms.fiveKills,
      adr:    parseFloat((ms.damage / rr).toFixed(1)),
      kd:     ms.deaths > 0 ? parseFloat((ms.kills / ms.deaths).toFixed(2)) : ms.kills,
      kast:   rr > 0 ? parseFloat(((ms.kastRounds / rr) * 100).toFixed(1)) : 0,
      hsRate: ms.kills > 0 ? parseFloat(((ms.headshots / ms.kills) * 100).toFixed(1)) : 0,
      galaxyRating: calcGalaxyRating({ kills: ms.kills, deaths: ms.deaths, assists: ms.assists, damage: ms.damage, kastRounds: ms.kastRounds, rounds: rr }),
    };
  }).sort((a, b) => b.matches - a.matches);

  return {
    steamId: actualKey,
    name:    db?.name  || g?.name  || actualKey,
    photo:   db?.photo || g?.photo || null,
    teamId:  db?.teamId|| g?.teamId|| null,
    matchesPlayed: g?.matchesPlayed || 0,
    kills: g?.kills || 0, deaths: g?.deaths || 0, assists: g?.assists || 0,
    headshots: g?.headshots || 0, damage: g?.damage || 0, rounds: r,
    kastRounds: g?.kastRounds || 0,
    mvps:        g?.mvps        || 0,
    firstKills:  g?.firstKills  || 0,
    firstDeaths: g?.firstDeaths || 0,
    threeKills:  g?.threeKills  || 0,
    fourKills:   g?.fourKills   || 0,
    fiveKills:   g?.fiveKills   || 0,
    bombPlants:  g?.bombPlants  || 0,
    bombDefuses: g?.bombDefuses || 0,
    adr:    parseFloat(((g?.damage || 0) / r).toFixed(1)),
    kd:     (g?.deaths || 0) > 0 ? parseFloat(((g?.kills || 0) / g.deaths).toFixed(2)) : (g?.kills || 0),
    kpr:    parseFloat(((g?.kills   || 0) / r).toFixed(3)),
    dpr:    parseFloat(((g?.deaths  || 0) / r).toFixed(3)),
    kast:   parseFloat((((g?.kastRounds || 0) / r) * 100).toFixed(1)),
    hsRate: (g?.kills || 0) > 0 ? parseFloat((((g?.headshots || 0) / g.kills) * 100).toFixed(1)) : 0,
    galaxyRating: g ? calcGalaxyRating(g) : 0,
    mapStats,
    recentMatches: matchHistory.slice(0, 20).map(m => {
      const p = m.players[actualKey] || m.players[steamId];
      return { id: m.id, mapName: m.mapName, teamCT: m.teamCT, teamT: m.teamT, winner: m.winner, roundCount: m.roundCount, finishedAt: m.finishedAt || m.startedAt, playerStats: p };
    }),
  };
}

function getTeamStats(teamName, teamsDb, playersDb) {
  const key = teamName.toLowerCase();
  const actualKey = Object.keys(statsData.global.teams).find(k => k.toLowerCase() === key) || key;
  const g  = statsData.global.teams[actualKey];
  if (!g) return null;
  const db = teamsDb.find(t => t.name.toLowerCase() === key);

  const matches = statsData.matchHistory.filter(m =>
    m.teamCT?.name?.toLowerCase() === key || m.teamT?.name?.toLowerCase() === key
  );

  // Per-map with CT/T round breakdown (side switch at round 13)
  const mapStats = Object.entries(g.mapStats || {}).map(([mk, ms]) => {
    let ctRoundsWon = 0, tRoundsWon = 0;
    matches.filter(m => m.mapName?.toLowerCase() === mk).forEach(m => {
      const isCT = m.teamCT?.name?.toLowerCase() === key;
      Object.entries(m.roundOutcomes || {}).forEach(([rn, outcome]) => {
        const n = parseInt(rn);
        const thisTeamIsCT = isCT ? (n <= 12) : (n > 12);
        if (thisTeamIsCT && outcome.startsWith('ct_win')) ctRoundsWon++;
        else if (!thisTeamIsCT && outcome.startsWith('t_win')) tRoundsWon++;
      });
    });
    return {
      map: mk, displayName: mk.replace('de_', '').toUpperCase(),
      played: ms.played, won: ms.won, lost: ms.played - ms.won,
      winRate: ms.played > 0 ? parseFloat(((ms.won / ms.played) * 100).toFixed(1)) : 0,
      ctRoundsWon, tRoundsWon,
    };
  }).sort((a, b) => b.played - a.played);

  // Roster (linked by teamId)
  const roster = playersDb
    .filter(p => db && String(p.teamId) === String(db.id))
    .map(p => {
      const gr = statsData.global.players[p.steamId] ||
                 Object.values(statsData.global.players).find(x => x.steamId?.toLowerCase() === p.steamId?.toLowerCase());
      if (!gr) return { steamId: p.steamId, name: p.name, photo: p.photo, matchesPlayed: 0, galaxyRating: 0, kills: 0, deaths: 0 };
      const rr = Math.max(gr.rounds || 0, 1);
      return {
        steamId: p.steamId, name: p.name, photo: p.photo,
        matchesPlayed: gr.matchesPlayed,
        kills: gr.kills, deaths: gr.deaths, mvps: gr.mvps || 0,
        adr:  parseFloat((gr.damage / rr).toFixed(1)),
        kd:   gr.deaths > 0 ? parseFloat((gr.kills / gr.deaths).toFixed(2)) : gr.kills,
        kast: parseFloat(((gr.kastRounds / rr) * 100).toFixed(1)),
        hsRate: gr.kills > 0 ? parseFloat(((gr.headshots / gr.kills) * 100).toFixed(1)) : 0,
        galaxyRating: calcGalaxyRating(gr),
      };
    })
    .sort((a, b) => (b.galaxyRating || 0) - (a.galaxyRating || 0));

  const total = g.roundsWon + g.roundsLost;
  return {
    name: g.name, logo: db?.logo || g.logo || null,
    matchesPlayed: g.matchesPlayed, matchesWon: g.matchesWon, matchesLost: g.matchesPlayed - g.matchesWon,
    winRate: g.matchesPlayed > 0 ? parseFloat(((g.matchesWon / g.matchesPlayed) * 100).toFixed(1)) : 0,
    roundsWon: g.roundsWon, roundsLost: g.roundsLost,
    roundWinRate: total > 0 ? parseFloat(((g.roundsWon / total) * 100).toFixed(1)) : 0,
    mapStats, roster,
    recentMatches: matches.slice(0, 20).map(m => ({
      id: m.id, mapName: m.mapName, teamCT: m.teamCT, teamT: m.teamT,
      winner: m.winner, roundCount: m.roundCount, finishedAt: m.finishedAt || m.startedAt,
    })),
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  onGsiUpdate,
  getCurrentMatchStats,
  getGlobalPlayerRatings,
  getGlobalTeamRatings,
  getMapStats,
  getPlayerStats,
  getTeamStats,
  deleteMatch,
  getMatchHistory:  () => statsData.matchHistory,
  getGlobalStats:   () => statsData.global,
  statsData,
};
