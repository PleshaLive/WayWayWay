/**
 * Match Finalization Logic
 * 
 * Handles:
 * - Finalizing matches from live data
 * - Calculating final stats
 * - Saving to completedMatches and postmatch files
 * - Updating team/player/map statistics
 */

const fs = require('fs');
const path = require('path');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(asNumber(value, 0) * factor) / factor;
}

function calculateKD(kills, deaths) {
  if (deaths === 0) return roundTo(kills, 2);
  return roundTo(kills / deaths, 2);
}

function calculateCustomRating({ kills, assists, deaths, adr, plusMinus }) {
  const raw =
    kills * 0.35 +
    assists * 0.1 -
    deaths * 0.2 +
    adr * 0.015 +
    plusMinus * 0.05;

  // Normalize to overlay-friendly range.
  const normalized = clamp(0.5 + raw / 20, 0.5, 1.8);
  return roundTo(normalized, 2);
}

function createTopEntry(player, value) {
  return {
    id: player.id,
    name: player.name,
    nickname: player.nickname,
    photo: player.photo,
    teamId: player.teamId,
    teamLogo: player.teamLogo,
    value: roundTo(value, 2)
  };
}

function sortPlayersForRanking(a, b) {
  if (b.rating !== a.rating) return b.rating - a.rating;
  if (b.kills !== a.kills) return b.kills - a.kills;
  if (b.adr !== a.adr) return b.adr - a.adr;
  return a.deaths - b.deaths;
}

function buildTopPlayers(players) {
  const byMetric = (selector) =>
    [...players]
      .sort((a, b) => {
        const diff = selector(b) - selector(a);
        if (diff !== 0) return diff;
        return a.deaths - b.deaths;
      })
      .slice(0, 5)
      .map((p) => createTopEntry(p, selector(p)));

  return {
    kills: byMetric((p) => p.kills),
    adr: byMetric((p) => p.adr),
    damage: byMetric((p) => p.damage),
    kd: byMetric((p) => p.kd),
    plusMinus: byMetric((p) => p.plusMinus),
    rating: byMetric((p) => p.rating),
    survivalRate: byMetric((p) => p.survivalRate),
    multiKills: byMetric(
      (p) =>
        p.multiKills.twoKillRounds * 2 +
        p.multiKills.threeKillRounds * 3 +
        p.multiKills.fourKillRounds * 4 +
        p.multiKills.fiveKillRounds * 5
    )
  };
}

function chooseMvp(players) {
  if (!players.length) return null;

  const byRating = [...players].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return a.deaths - b.deaths;
  });

  const bestRating = byRating[0]?.rating;
  const ratingCandidates = byRating.filter((p) => p.rating === bestRating);
  if (ratingCandidates.length) {
    const winner = [...ratingCandidates].sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.deaths - b.deaths;
    })[0];
    return {
      id: winner.id,
      name: winner.name,
      nickname: winner.nickname,
      photo: winner.photo,
      teamId: winner.teamId,
      teamLogo: winner.teamLogo,
      kills: winner.kills,
      deaths: winner.deaths,
      adr: winner.adr,
      rating: winner.rating,
      reason: 'highest_rating'
    };
  }

  const byAdr = [...players].sort((a, b) => {
    if (b.adr !== a.adr) return b.adr - a.adr;
    return a.deaths - b.deaths;
  });
  if (byAdr.length) {
    const winner = byAdr[0];
    return {
      id: winner.id,
      name: winner.name,
      nickname: winner.nickname,
      photo: winner.photo,
      teamId: winner.teamId,
      teamLogo: winner.teamLogo,
      kills: winner.kills,
      deaths: winner.deaths,
      adr: winner.adr,
      rating: winner.rating,
      reason: 'highest_adr'
    };
  }

  const byKills = [...players].sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills;
    return a.deaths - b.deaths;
  });
  const winner = byKills[0];
  return {
    id: winner.id,
    name: winner.name,
    nickname: winner.nickname,
    photo: winner.photo,
    teamId: winner.teamId,
    teamLogo: winner.teamLogo,
    kills: winner.kills,
    deaths: winner.deaths,
    adr: winner.adr,
    rating: winner.rating,
    reason: 'highest_kills'
  };
}

function buildTeamTotals(teamPlayers) {
  if (!teamPlayers.length) {
    return {
      kills: 0,
      deaths: 0,
      assists: 0,
      damage: 0,
      adr: 0,
      ratingAvg: 0
    };
  }

  const totals = teamPlayers.reduce(
    (acc, p) => {
      acc.kills += p.kills;
      acc.deaths += p.deaths;
      acc.assists += p.assists;
      acc.damage += p.damage;
      acc.adr += p.adr;
      acc.rating += p.rating;
      return acc;
    },
    { kills: 0, deaths: 0, assists: 0, damage: 0, adr: 0, rating: 0 }
  );

  return {
    kills: totals.kills,
    deaths: totals.deaths,
    assists: totals.assists,
    damage: totals.damage,
    adr: roundTo(totals.adr / teamPlayers.length, 2),
    ratingAvg: roundTo(totals.rating / teamPlayers.length, 2)
  };
}

/**
 * Finalize a match - save postmatch data and update statistics
 * 
 * @param {string} matchId - Match ID
 * @param {Object} liveData - Current scoreboard data
 * @param {Array} registeredPlayers - Array of registered players
 * @param {Array} registeredTeams - Array of registered teams
 * @param {string} storagePath - Path to storage directory
 * @returns {Object} Finalized match data
 */
function finalizeMatch(
  matchId,
  liveData,
  registeredPlayers,
  registeredTeams,
  storagePath,
  options = {}
) {
  try {
    if (!liveData || !liveData.map || !liveData.players) {
      throw new Error('Invalid live data for match finalization');
    }

    const map = liveData.map;
    const teamCT = map.team_ct || { name: 'CT', score: 0 };
    const teamT = map.team_t || { name: 'T', score: 0 };

    const registeredCT = registeredTeams.find(
      (t) => t.name?.toLowerCase() === teamCT.name?.toLowerCase()
    );
    const registeredT = registeredTeams.find(
      (t) => t.name?.toLowerCase() === teamT.name?.toLowerCase()
    );

    // Determine winner
    const ctScore = teamCT.score || 0;
    const tScore = teamT.score || 0;
    let winnerSide = null;
    let winnerTeamId = null;

    if (ctScore > tScore) {
      winnerSide = 'CT';
      winnerTeamId = registeredCT?.id || null;
    } else if (tScore > ctScore) {
      winnerSide = 'T';
      winnerTeamId = registeredT?.id || null;
    }

    // Collect all 10 players
    const allPlayers = [];
    let ctCount = 0, tCount = 0;

    for (const steamId in liveData.players) {
      const gsiPlayer = liveData.players[steamId];
      const side = gsiPlayer.team;

      if (side === 'CT') ctCount++;
      if (side === 'T') tCount++;

      // Skip if more than 5 from same side
      if ((side === 'CT' && ctCount > 5) || (side === 'T' && tCount > 5)) continue;

      const regPlayer = registeredPlayers.find(
        (p) => p.steamId?.toLowerCase() === steamId.toLowerCase()
      );

      const roundsPlayed = asNumber(map.round, 0);
      const kills = asNumber(gsiPlayer.match_stats?.kills, 0);
      const assists = asNumber(gsiPlayer.match_stats?.assists, 0);
      const deaths = asNumber(gsiPlayer.match_stats?.deaths, 0);
      const damage = asNumber(gsiPlayer.accumulatedDmg, 0);
      const survivedRounds = asNumber(
        gsiPlayer.match_stats?.survived_rounds ?? gsiPlayer.match_stats?.survivedRounds,
        0
      );
      const plusMinus = kills - deaths;
      const adr = roundsPlayed > 0 ? roundTo(damage / roundsPlayed, 1) : 0;
      const damagePerKill = kills > 0 ? roundTo(damage / kills, 1) : 0;
      const survivalRate = roundsPlayed > 0 ? roundTo((survivedRounds / roundsPlayed) * 100, 1) : 0;
      const kd = calculateKD(kills, deaths);
      const customRating = calculateCustomRating({ kills, assists, deaths, adr, plusMinus });

      const oneKillRounds = asNumber(
        gsiPlayer.match_stats?.oneKillRounds ?? gsiPlayer.match_stats?.multikills_1k,
        0
      );
      const twoKillRounds = asNumber(
        gsiPlayer.match_stats?.twoKillRounds ?? gsiPlayer.match_stats?.multikills_2k,
        0
      );
      const threeKillRounds = asNumber(
        gsiPlayer.match_stats?.threeKillRounds ?? gsiPlayer.match_stats?.multikills_3k,
        0
      );
      const fourKillRounds = asNumber(
        gsiPlayer.match_stats?.fourKillRounds ?? gsiPlayer.match_stats?.multikills_4k,
        0
      );
      const fiveKillRounds = asNumber(
        gsiPlayer.match_stats?.fiveKillRounds ?? gsiPlayer.match_stats?.multikills_5k,
        0
      );

      const ctSideRounds = asNumber(gsiPlayer.match_stats?.ct_rounds, 0);
      const tSideRounds = asNumber(gsiPlayer.match_stats?.t_rounds, 0);
      const ctDamage = asNumber(gsiPlayer.match_stats?.ct_damage, 0);
      const tDamage = asNumber(gsiPlayer.match_stats?.t_damage, 0);
      const ctKills = asNumber(gsiPlayer.match_stats?.ct_kills, 0);
      const tKills = asNumber(gsiPlayer.match_stats?.t_kills, 0);
      const ctDeaths = asNumber(gsiPlayer.match_stats?.ct_deaths, 0);
      const tDeaths = asNumber(gsiPlayer.match_stats?.t_deaths, 0);
      const ctAssists = asNumber(gsiPlayer.match_stats?.ct_assists, 0);
      const tAssists = asNumber(gsiPlayer.match_stats?.t_assists, 0);

      const teamMeta = side === 'CT'
        ? {
            id: regPlayer?.teamId || registeredCT?.id || null,
            name: teamCT.name || 'CT',
            logo: registeredCT?.logo || '/logos/none-team.png'
          }
        : {
            id: regPlayer?.teamId || registeredT?.id || null,
            name: teamT.name || 'T',
            logo: registeredT?.logo || '/logos/none-team.png'
          };

      const playerData = {
        id: regPlayer?.id || `temp_${steamId}`,
        steamId: steamId,
        name: regPlayer?.name || gsiPlayer.name || 'Unknown',
        nickname: regPlayer?.nickname || gsiPlayer.name || 'Unknown',
        photo: regPlayer?.photo || '/NoneP.png',
        teamId: teamMeta.id,
        teamName: teamMeta.name,
        teamLogo: teamMeta.logo,
        kills,
        deaths,
        assists,
        kd,
        plusMinus,
        damage,
        adr: adr,
        damagePerKill,
        roundsPlayed: roundsPlayed,
        survivedRounds,
        survivalRate,
        customRating,
        rating: customRating,
        impact: null,
        kast: null,
        headshots: null,
        headshotRate: null,
        firstKills: null,
        firstDeaths: null,
        entryDiff: null,
        multiKills: {
          oneKillRounds,
          twoKillRounds,
          threeKillRounds,
          fourKillRounds,
          fiveKillRounds
        },
        clutches: {
          attempts: null,
          wins: null,
          losses: null,
          oneVsOne: null,
          oneVsTwo: null,
          oneVsThree: null,
          oneVsFour: null,
          oneVsFive: null
        },
        sideStats: {
          CT: {
            rounds: ctSideRounds,
            kills: ctKills,
            deaths: ctDeaths,
            assists: ctAssists,
            damage: ctDamage,
            adr: ctSideRounds > 0 ? roundTo(ctDamage / ctSideRounds, 1) : 0
          },
          T: {
            rounds: tSideRounds,
            kills: tKills,
            deaths: tDeaths,
            assists: tAssists,
            damage: tDamage,
            adr: tSideRounds > 0 ? roundTo(tDamage / tSideRounds, 1) : 0
          }
        },
        rounds: options.playerRoundsMap?.[steamId] || []
      };

      allPlayers.push(playerData);
    }

    // Sort by rating/kills for stable graphics output.
    allPlayers.sort(sortPlayersForRanking);

    const topPlayers = buildTopPlayers(allPlayers);
    const mvp = chooseMvp(allPlayers);

    const teamA = {
      id: registeredCT?.id || null,
      name: teamCT.name || 'CT',
      shortName: registeredCT?.shortName || (teamCT.name || 'CT').substring(0, 3).toUpperCase(),
      logo: registeredCT?.logo || '/logos/none-team.png',
      score: ctScore,
      result:
        winnerSide === 'CT' ? 'winner' : winnerSide === 'T' ? 'loser' : 'draw'
    };

    const teamB = {
      id: registeredT?.id || null,
      name: teamT.name || 'T',
      shortName: registeredT?.shortName || (teamT.name || 'T').substring(0, 3).toUpperCase(),
      logo: registeredT?.logo || '/logos/none-team.png',
      score: tScore,
      result:
        winnerSide === 'T' ? 'winner' : winnerSide === 'CT' ? 'loser' : 'draw'
    };

    const teamAPlayers = allPlayers
      .filter((p) => (teamA.id ? p.teamId === teamA.id : p.teamName === teamA.name))
      .sort(sortPlayersForRanking);
    const teamBPlayers = allPlayers
      .filter((p) => (teamB.id ? p.teamId === teamB.id : p.teamName === teamB.name))
      .sort(sortPlayersForRanking);

    const teamStats = {
      teamA: buildTeamTotals(teamAPlayers),
      teamB: buildTeamTotals(teamBPlayers)
    };

    // Build postmatch object
    const postmatchData = {
      mode: 'postmatch',
      matchId: matchId,
      status: 'finished',
      map: map.name || 'unknown',
      winnerTeamId: winnerTeamId,
      updatedAt: new Date().toISOString(),

      teamA,
      teamB,

      players: allPlayers,
      teamAPlayers,
      teamBPlayers,
      teamStats,
      topPlayers: topPlayers,
      mvp: mvp,
      roundHistory: options.roundsHistory || []
    };

    // Save postmatch data
    const postmatchFile = path.join(storagePath, 'postmatch.json');
    fs.writeFileSync(postmatchFile, JSON.stringify(postmatchData, null, 2), 'utf8');

    // Save to completedMatches
    const completedFile = path.join(storagePath, 'completedMatches.json');
    let completed = [];
    if (fs.existsSync(completedFile)) {
      try {
        completed = JSON.parse(fs.readFileSync(completedFile, 'utf8'));
      } catch (e) {
        completed = [];
      }
    }

    // Check if match already exists
    const existingIndex = completed.findIndex(m => m.matchId === matchId);
    if (existingIndex >= 0) {
      completed[existingIndex] = postmatchData;
    } else {
      completed.push(postmatchData);
    }

    fs.writeFileSync(completedFile, JSON.stringify(completed, null, 2), 'utf8');

    return postmatchData;
  } catch (err) {
    console.error('Error finalizing match:', err);
    throw err;
  }
}

module.exports = {
  finalizeMatch
};
