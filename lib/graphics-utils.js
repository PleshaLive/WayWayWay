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

/**
 * Normalize player for graphics API output
 * Builds a complete player object with all fields for broadcast/overlay use
 * @param {Object} player - Player object from data.json
 * @param {Object} team - Team object (optional)
 * @param {string} baseUrl - Base URL for images (e.g., 'http://localhost:2727')
 * @returns {Object} Normalized player object
 */
function normalizePlayerForGraphics(player, team, baseUrl = '') {
  if (!player) return null;

  // Extract nickname from various possible field names
  const nickname = player.nickname || player.name || player.player || player.nick || '';

  // Extract first/last name from various possible formats
  const firstName = player.firstName || player['First Name'] || player.firstname || player.FirstName || null;
  const lastName = player.lastName || player['Last Name'] || player.lastname || player.LastName || null;

  // Build fullName if not present
  const fullName = player.fullName || player['Full Name'] || 
    (firstName && lastName ? `${firstName} ${lastName}` : 
     firstName || lastName || nickname);

  // Extract country code from various formats
  const countryCode = (player.countryCode || player['Country Code'] || player.country_code || player.country || '').toUpperCase() || null;

  // Handle photo with fallback
  const photoValue = player.photo || player.avatar || null;
  const photo = photoValue && photoValue.startsWith('http') 
    ? photoValue 
    : photoValue 
      ? `${baseUrl}${photoValue}` 
      : `${baseUrl}/NoneP.png`;

  // Get team info if team provided
  const teamId = player.teamId || team?.id || null;
  const teamName = player.teamName || team?.name || null;
  const teamLogo = team?.logo 
    ? (team.logo.startsWith('http') ? team.logo : `${baseUrl}${team.logo}`)
    : `${baseUrl}/logos/none-team.png`;

  return {
    id: player.id || '',
    steamId: player.steamId || null,
    nickname: nickname,
    name: nickname,
    firstName: firstName,
    lastName: lastName,
    fullName: fullName,
    country: player.country_name || null, // Full country name if available
    countryCode: countryCode,
    role: player.role || '',
    photo: photo,
    teamId: teamId,
    teamName: teamName,
    teamLogo: teamLogo
  };
}

/**
 * Normalize team for graphics API output
 * Builds a complete team object with players for broadcast/overlay use
 * @param {Object} team - Team object from data.json
 * @param {Array} allPlayers - All players from data.json
 * @param {string} baseUrl - Base URL for images
 * @returns {Object} Normalized team object with players
 */
function normalizeTeamForGraphics(team, allPlayers = [], baseUrl = '') {
  if (!team) return null;

  // Extract shortName/tag from various formats
  const shortName = team.shortName || team.tag || team.name?.substring(0, 3).toUpperCase() || '';
  const tag = team.tag || team.shortName || shortName;

  // Handle logo with fallback
  const logo = team.logo
    ? (team.logo.startsWith('http') ? team.logo : `${baseUrl}${team.logo}`)
    : `${baseUrl}/logos/none-team.png`;

  // Extract country code
  const countryCode = (team.countryCode || team.country_code || team.country || '').toUpperCase() || null;

  // Match players to this team by various methods
  const teamPlayers = allPlayers
    .filter(p => {
      // Direct teamId match
      if (p.teamId === team.id) return true;
      // Match by team name (case-insensitive)
      if (p.teamName && p.teamName.toLowerCase() === team.name.toLowerCase()) return true;
      // Match by team field
      if (p.team && p.team.toLowerCase() === team.name.toLowerCase()) return true;
      // Match by shortName
      if (p.team && p.team.toLowerCase() === shortName.toLowerCase()) return true;
      return false;
    })
    .map(p => normalizePlayerForGraphics(p, team, baseUrl));

  return {
    id: team.id || '',
    name: team.name || '',
    shortName: shortName,
    tag: tag,
    country: team.country || null,
    countryCode: countryCode,
    logo: logo,
    players: teamPlayers,
    playersCount: teamPlayers.length
  };
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
  withDefaults,
  normalizePlayerForGraphics,
  normalizeTeamForGraphics
};
