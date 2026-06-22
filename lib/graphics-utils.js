/**
 * Graphics & Broadcast Utils
 * 
 * Resolver helpers for graphics endpoints:
 * - Player/Team resolution from GSI + registered data
 * - Photo/Logo fallbacks
 * - Data formatting for broadcast/overlay systems
 */

/**
 * Resolve player by SteamID
 * @param {string} steamId - Player's SteamID
 * @param {Array} registeredPlayers - Array of registered players from data.json
 * @returns {Object} Player object or null
 */
function resolvePlayerBySteamId(steamId, registeredPlayers = []) {
  if (!steamId) return null;
  const found = registeredPlayers.find(
    p => p.steamId?.toLowerCase() === steamId.toLowerCase()
  );
  return found || null;
}

/**
 * Resolve team by ID
 * @param {string} teamId - Team's ID
 * @param {Array} registeredTeams - Array of registered teams from data.json
 * @returns {Object} Team object or null
 */
function resolveTeamById(teamId, registeredTeams = []) {
  if (!teamId) return null;
  return registeredTeams.find(t => t.id === teamId) || null;
}

/**
 * Resolve team by Name (case-insensitive)
 * @param {string} teamName - Team's name
 * @param {Array} registeredTeams - Array of registered teams from data.json
 * @returns {Object} Team object or null
 */
function resolveTeamByName(teamName, registeredTeams = []) {
  if (!teamName) return null;
  return registeredTeams.find(
    t => t.name.toLowerCase() === teamName.toLowerCase()
  ) || null;
}

/**
 * Resolve team logo with fallback
 * @param {Object} team - Team object
 * @param {string} baseUrl - Base URL for logos
 * @returns {string} Full URL to logo or fallback
 */
function resolveLogo(team, baseUrl = '', defaultLogo = '/logos/none-team.png') {
  if (!team) return `${baseUrl}${defaultLogo}`;
  
  const logo = team.logo;
  if (!logo) return `${baseUrl}${defaultLogo}`;
  
  // If already full URL, return as-is
  if (logo.startsWith('http')) {
    return logo;
  }
  
  // Otherwise, prepend baseUrl
  return `${baseUrl}${logo.startsWith('/') ? '' : '/'}${logo}`;
}

/**
 * Resolve player photo with fallback
 * @param {Object} player - Player object
 * @param {string} baseUrl - Base URL for photos
 * @returns {string} Full URL to photo or fallback
 */
function resolvePlayerPhoto(player, baseUrl = '', defaultPhoto = '/NoneP.png') {
  if (!player) return `${baseUrl}${defaultPhoto}`;
  
  const photo = player.photo;
  if (!photo) return `${baseUrl}${defaultPhoto}`;
  
  // If already full URL, return as-is
  if (photo.startsWith('http')) {
    return photo;
  }
  
  // Otherwise, prepend baseUrl
  return `${baseUrl}${photo.startsWith('/') ? '' : '/'}${photo}`;
}

/**
 * Resolve player from GSI + registered data
 * @param {Object} gsiPlayer - Player data from GSI (scoreboard.players[steamId])
 * @param {string} steamId - Player's SteamID
 * @param {Array} registeredPlayers - Array of registered players
 * @param {string} baseUrl - Base URL for photos
 * @returns {Object} Resolved player object
 */
function resolvePlayerProfileFromGSI(gsiPlayer, steamId, registeredPlayers = [], baseUrl = '') {
  if (!gsiPlayer || !steamId) return null;

  // Start with GSI data
  let resolved = { ...gsiPlayer };

  // Try to find in registered players
  const regPlayer = resolvePlayerBySteamId(steamId, registeredPlayers);
  
  // Override/supplement with registered data
  if (regPlayer) {
    resolved.id = regPlayer.id;
    resolved.name = regPlayer.name || resolved.name;
    resolved.nickname = regPlayer.nickname || resolved.name || 'Unknown';
    resolved.photo = resolvePlayerPhoto(regPlayer, baseUrl);
    resolved.teamId = regPlayer.teamId;
  } else {
    // Temporary player - no registration
    resolved.id = `temp_${steamId}`;
    resolved.nickname = resolved.name || 'Unknown';
    resolved.photo = resolvePlayerPhoto(null, baseUrl);
  }

  resolved.steamId = steamId;
  return resolved;
}

/**
 * Resolve team from GSI + registered data
 * @param {Object} gsiTeam - Team data from GSI (scoreboard.map.team_ct or team_t)
 * @param {string} side - 'CT' or 'T'
 * @param {Array} registeredTeams - Array of registered teams
 * @param {string} baseUrl - Base URL for logos
 * @returns {Object} Resolved team object
 */
function resolveTeamProfileFromGSI(gsiTeam, side, registeredTeams = [], baseUrl = '') {
  if (!gsiTeam) {
    return {
      id: null,
      name: side,
      shortName: side,
      logo: resolveLogo(null, baseUrl),
      side: side,
      score: 0
    };
  }

  // Try to find in registered teams by name
  const regTeam = resolveTeamByName(gsiTeam.name, registeredTeams);

  let resolved = {
    id: regTeam?.id || null,
    name: gsiTeam.name || side,
    shortName: regTeam?.shortName || gsiTeam.name?.substring(0, 3).toUpperCase() || side,
    logo: regTeam ? resolveLogo(regTeam, baseUrl) : resolveLogo(null, baseUrl),
    side: side,
    score: gsiTeam.score || 0,
    consecutive_round_losses: gsiTeam.consecutive_round_losses,
    timeouts_remaining: gsiTeam.timeouts_remaining,
    matches_won_this_series: gsiTeam.matches_won_this_series
  };

  return resolved;
}

/**
 * Calculate K/D ratio
 * @param {number} kills
 * @param {number} deaths
 * @returns {number} K/D ratio
 */
function calculateKD(kills, deaths) {
  if (deaths === 0) return kills;
  return parseFloat((kills / deaths).toFixed(2));
}

/**
 * Ensure all fields exist with defaults
 * @param {Object} obj - Object to fill
 * @param {Object} defaults - Default values
 * @returns {Object} Merged object
 */
function withDefaults(obj, defaults) {
  return { ...defaults, ...obj };
}

module.exports = {
  resolvePlayerBySteamId,
  resolveTeamById,
  resolveTeamByName,
  resolveLogo,
  resolvePlayerPhoto,
  resolvePlayerProfileFromGSI,
  resolveTeamProfileFromGSI,
  calculateKD,
  withDefaults
};
