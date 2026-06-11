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
    kills: 0, deaths: 0, assists: 0,
    headshots: 0,
    damage: 0,       // total damage this match (accumulated)
    rounds: 0,       // rounds participated in
    kastRounds: 0,   // rounds with Kill / Assist / Survived / Traded
    firstKills: 0,
    // per-round scratch for KAST detection
    _roundKills: 0, _roundAssists: 0, _survived: false, _traded: false,
    _lastRoundSeen: -1,
    _team: '',       // 'CT' or 'T'
    _name: '',       // player name from GSI
  };
}

function emptyTeamStats() {
  return {
    name: '',
    logo: null,
    roundsWon: 0,
    roundsLost: 0,
    totalKills: 0,
    totalDamage: 0,
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
      statsData.global         = statsData.global         || { players: {}, teams: {} };
      statsData.global.players = statsData.global.players || {};
      statsData.global.teams   = statsData.global.teams   || {};
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
    players: {},    // steamId → emptyPlayerStats()
    roundCount: 0,
    // scratch
    _lastRoundCount: 0,
    _prevPhase: null,
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
    if (mapName && mapPhase !== 'gameover') {
      currentMatch = freshMatch(mapName, teamCT, teamT);
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

  // ── 3. Detect new round ────────────────────────────────────────────────────
  const newRound = roundCount > currentMatch._lastRoundCount;
  if (newRound) {
    currentMatch.roundCount       = roundCount;
    currentMatch._lastRoundCount  = roundCount;
    // Commit per-round scratch for KAST
    _commitRoundKast(currentMatch);
  }

  // ── 4. Update per-player stats ────────────────────────────────────────────
  for (const steamId in allplayers) {
    const gp = allplayers[steamId];
    if (!currentMatch.players[steamId]) {
      currentMatch.players[steamId] = emptyPlayerStats();
    }
    const ps = currentMatch.players[steamId];
    const ms = gp.match_stats || {};

    // Store team and name from GSI
    if (gp.team)  ps._team = gp.team;
    if (gp.name)  ps._name = gp.name;

    // Direct match_stats from GSI (cumulative over the whole match)
    // Use explicit check to avoid || operator bug (0 is falsy)
    if (ms.kills     !== undefined) ps.kills     = ms.kills;
    if (ms.deaths    !== undefined) ps.deaths    = ms.deaths;
    if (ms.assists   !== undefined) ps.assists   = ms.assists;
    if (ms.headshots !== undefined) ps.headshots = ms.headshots;

    // Damage: we track accumulated via round_totaldmg resets (per-round)
    const roundDmg = (gp.state && gp.state.round_totaldmg) || 0;
    if (roundDmg > (ps._prevRoundDmg || 0)) {
      ps._roundDmgCurrent = roundDmg;
    } else if (roundDmg === 0 && (ps._prevRoundDmg || 0) > 0) {
      // round flipped — add previous round's damage
      ps.damage += ps._prevRoundDmg || 0;
    }
    ps._prevRoundDmg = roundDmg;

    // Rounds played = total rounds seen while this player was in the match
    if (newRound && ps._lastRoundSeen < roundCount) {
      ps.rounds = Math.max(ps.rounds, roundCount);
      ps._lastRoundSeen = roundCount;
    }

    // Per-round KAST scratch
    if ((ms.kills || 0) > ps._roundKills) ps._roundKills = ms.kills || 0;
    if ((ms.assists || 0) > ps._roundAssists) ps._roundAssists = ms.assists || 0;
    if (gp.state && gp.state.health > 0) ps._survived = true;
  }
}

function _commitRoundKast(match) {
  for (const steamId in match.players) {
    const ps = match.players[steamId];
    const hadKill    = ps._roundKills   > 0;
    const hadAssist  = ps._roundAssists > 0;
    const survived   = ps._survived;
    const traded     = ps._traded;
    if (hadKill || hadAssist || survived || traded) ps.kastRounds++;
    // reset scratch
    ps._roundKills   = 0;
    ps._roundAssists = 0;
    ps._survived     = false;
    ps._traded       = false;
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
    players: {},
  };

  const rounds = Math.max(match.roundCount, 1);

  for (const steamId in match.players) {
    const ps  = match.players[steamId];
    const db  = resolvePlayer(steamId, null, playersDb);
    const dmg = ps.damage + (ps._prevRoundDmg || 0); // include current round
    const r   = ps.rounds || rounds;

    const stats = {
      steamId,
      name:    db?.name  || '',
      photo:   db?.photo || null,
      teamId:  db?.teamId || null,
      kills:   ps.kills,
      deaths:  ps.deaths,
      assists: ps.assists,
      headshots: ps.headshots,
      damage:  dmg,
      rounds:  r,
      kastRounds: ps.kastRounds,
      adr:    r > 0 ? parseFloat((dmg / r).toFixed(1)) : 0,
      kd:     ps.deaths > 0 ? parseFloat((ps.kills / ps.deaths).toFixed(2)) : parseFloat(ps.kills.toFixed(2)),
      kpr:    r > 0 ? parseFloat((ps.kills / r).toFixed(3)) : 0,
      dpr:    r > 0 ? parseFloat((ps.deaths / r).toFixed(3)) : 0,
      kast:   r > 0 ? parseFloat(((ps.kastRounds / r) * 100).toFixed(1)) : 0,
    };
    stats.galaxyRating = calcGalaxyRating({ ...ps, damage: dmg, rounds: r });
    snapshot.players[steamId] = stats;
  }

  statsData.matchHistory.unshift(snapshot);
  if (statsData.matchHistory.length > 200) statsData.matchHistory.pop();

  // ── Merge into global stats ────────────────────────────────────────────────
  for (const steamId in snapshot.players) {
    const sp = snapshot.players[steamId];
    if (!statsData.global.players[steamId]) {
      statsData.global.players[steamId] = {
        steamId, name: sp.name, photo: sp.photo, teamId: sp.teamId,
        kills: 0, deaths: 0, assists: 0, headshots: 0,
        damage: 0, rounds: 0, kastRounds: 0, matchesPlayed: 0,
      };
    }
    const g = statsData.global.players[steamId];
    // update profile info
    if (sp.name)   g.name   = sp.name;
    if (sp.photo)  g.photo  = sp.photo;
    if (sp.teamId) g.teamId = sp.teamId;
    // accumulate
    g.kills       += sp.kills;
    g.deaths      += sp.deaths;
    g.assists     += sp.assists;
    g.headshots   += sp.headshots;
    g.damage      += sp.damage;
    g.rounds      += sp.rounds;
    g.kastRounds  += sp.kastRounds;
    g.matchesPlayed++;
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
      };
    }
    const gt = statsData.global.teams[key];
    if (info.logo && !gt.logo) gt.logo = info.logo;
    gt.matchesPlayed++;
    if (isWinner) gt.matchesWon++;
    gt.roundsWon  += score;
    gt.roundsLost += oppScore;
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
    const r   = ps.rounds || rounds;
    // Resolve name/photo from playersDb if available
    const db  = playersDb ? playersDb.find(p => p.steamId && p.steamId.toLowerCase() === steamId.toLowerCase()) : null;
    players[steamId] = {
      steamId,
      name:  db?.name  || ps._name || '',
      photo: db?.photo || null,
      _team: ps._team || '',
      kills: ps.kills, deaths: ps.deaths, assists: ps.assists,
      headshots: ps.headshots, damage: dmg, rounds: r,
      kastRounds: ps.kastRounds,
      adr:  r > 0 ? parseFloat((dmg / r).toFixed(1)) : 0,
      kd:   ps.deaths > 0 ? parseFloat((ps.kills / ps.deaths).toFixed(2)) : parseFloat(ps.kills.toFixed(2)),
      kpr:  r > 0 ? parseFloat((ps.kills / r).toFixed(3)) : 0,
      dpr:  r > 0 ? parseFloat((ps.deaths / r).toFixed(3)) : 0,
      kast: r > 0 ? parseFloat(((ps.kastRounds / r) * 100).toFixed(1)) : 0,
      galaxyRating: calcGalaxyRating({ ...ps, damage: dmg, rounds: r }),
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
  const base = req => req; // unused, just compute
  return Object.values(statsData.global.players)
    .map(g => {
      const r = g.rounds || 1;
      const db = playersDb.find(p => p.steamId && p.steamId.toLowerCase() === g.steamId.toLowerCase());
      const adr  = parseFloat((g.damage / r).toFixed(1));
      const kpr  = parseFloat((g.kills  / r).toFixed(3));
      const dpr  = parseFloat((g.deaths / r).toFixed(3));
      const kast = parseFloat(((g.kastRounds / r) * 100).toFixed(1));
      return {
        steamId: g.steamId,
        name: db?.name  || g.name  || g.steamId,
        photo: db?.photo || g.photo || null,
        teamId: db?.teamId || g.teamId || null,
        matchesPlayed: g.matchesPlayed,
        kills: g.kills, deaths: g.deaths, assists: g.assists,
        headshots: g.headshots, rounds: r,
        adr, kpr, dpr, kast,
        kd: g.deaths > 0 ? parseFloat((g.kills / g.deaths).toFixed(2)) : g.kills,
        galaxyRating: calcGalaxyRating(g),
      };
    })
    .sort((a, b) => b.galaxyRating - a.galaxyRating);
}

function getGlobalTeamRatings(teamsDb) {
  return Object.values(statsData.global.teams)
    .map(t => {
      const db = teamsDb.find(td => td.name.toLowerCase() === t.name.toLowerCase());
      return {
        name: t.name,
        logo: db?.logo || t.logo || null,
        matchesPlayed: t.matchesPlayed,
        matchesWon:    t.matchesWon,
        winRate: t.matchesPlayed > 0 ? parseFloat(((t.matchesWon / t.matchesPlayed) * 100).toFixed(1)) : 0,
        roundsWon:  t.roundsWon,
        roundsLost: t.roundsLost,
        roundWinRate: (t.roundsWon + t.roundsLost) > 0
          ? parseFloat(((t.roundsWon / (t.roundsWon + t.roundsLost)) * 100).toFixed(1))
          : 0,
      };
    })
    .sort((a, b) => b.winRate - a.winRate || b.roundWinRate - a.roundWinRate);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  onGsiUpdate,
  getCurrentMatchStats,
  getGlobalPlayerRatings,
  getGlobalTeamRatings,
  getMatchHistory:  () => statsData.matchHistory,
  getGlobalStats:   () => statsData.global,
  statsData,
};
