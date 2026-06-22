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

// Middleware -�-+-� -+-�-�-�-+-+-�-� JSON -+ URL-encoded -�-�-+-+-�-�
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// -�-�-+-�-�-+-�-� CORS -�-+-� -�-�-�-� -+-�-�-�-�-�-�-+-�
app.use(cors()); // <--- -�-�-�-�-+-�-�-�-�, -�-�-+ -�-�-� -�-�-�-+-�-� -�-�-�-�

// -�-�-�-�-+-�-�-�-�-+-� -�-�-�-+-� (-+-+-�-+-�-+-+-�, -�-+-�-+ -+ -�.-�.)
app.use(express.static(path.join(__dirname, 'public')));

// -�-�-�-� -� -�-�-�-+-� -�-+-� -�-�-�-+-�-+-+-� -�-�-+-+-�-� (persistent storage)
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

// -�-�-+-+-�-� -�-+-� -�-�-+-+-+-�-+ G�� -�-+-+-�-+-�-� -+ -+-�-�-+-�-+ (persistent storage)
let teams = [];      // -P-�-�-�-�-�-�: { id, name, logo, score }
let players = [];  // -P-�-�-�-�-�-�: { id, name, steamId, photo, teamId, match_stats }

// -P-�-�-�-�-� scoreboard -�-+-� -�-�-+-+-�-� GSI (-+-� CS:GO/CS2)
let scoreboard = {
  players: {},
  map: {},
  player: {}
};

// -�-+-+-�-�-+-�-+-�-� -+-�-�-�-+-�-+-+-�-� -�-+-� -�-�-�-+-�-+-+-� -+-�-�-+-�-+-+ -�-�-�-+-�-+-�
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

// ------------------------------
// -�-�-+-�-�-+-� -+-�-�-�-�-+-�-+ -�-�-+-+-�-� -+-+ data.json
// ------------------------------
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const jsonData = JSON.parse(raw);
      teams = jsonData.teams || [];
      players = jsonData.players || [];
      console.log("-�-�-+-+-�-� -+-�-�-�-�-�-�-+-� -+-+ data.json");
    } catch (err) {
      console.error("-P-�-+-�-�-� -+-�-+ -�-�-�-+-+-+ data.json:", err);
      teams = [];
      players = [];
    }
  } else {
    console.log("-�-�-�-+ data.json -+-� -+-�-�-�-�-+, -+-�-�-+-+-�-�-+ -� -+-�-�-�-�-� -�-�-+-+-�-�");
  }
}

// -�-�-+-�-�-+-� -�-+-�-�-�-+-�-+-+-� -�-�-+-+-�-� -� data.json
function saveData() {
  const jsonData = { teams, players };
  fs.writeFileSync(DATA_FILE, JSON.stringify(jsonData, null, 2), 'utf8');
  console.log("-�-�-+-+-�-� -�-+-�-�-�-+-�-+-� -� data.json");
}

// -�-�-�-�-�-�-�-�-+ -�-�-+-+-�-� -+-�-+ -�-�-�-�-�-� -�-�-�-�-�-�-�
loadData();

// ------------------------------
// -�-�-�-�-�-+-�-�-� Multer -�-+-� -+-�-�-�-�-+-�-+ -+-+-�-+-�-+-+-+-� -�-+-+-�-+-�
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
// -�-�-�-�-�-+-�-�-� Multer -�-+-� -+-�-�-�-�-+-�-+ -�-+-�-+-�-�-�-�-+-� -+-�-�-+-�-+-�
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
  if (!url) return url; // -�-�-+-+ URL -+-�-�-�-+-�, -�-+-+-�-�-�-�-�-�-+ -�-�-� -�-�-�-�
  if ((url.startsWith("http:/") && !url.startsWith("http://")) ||
      (url.startsWith("https:/") && !url.startsWith("https://"))) {
    return url.replace(/^https?:\//, match => match + '/');
  }
  return url;
}


// ------------------------------
// -�-�-�-�-+-+-�-�-�-�-+-�-+-+-�-� -+-�-�-+ -�-+-� Side_logo -+ winType_logo
// ------------------------------
// -P-+-�-�-�-�-+-�-+-+-� baseUrl -�-+-+-�-+-+ -�-�-�-� -�-+-+-�-+-+-�-�-�-�-+-+ -+-+-+ -+-+ -+-�-�-�-+-�-+-+-�-� -+-�-�-�-�-�-+-+-�
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

// -�-�-�-+-+-�-+-�-� -+-+-+-�-�-�-�-�-+-+-� -�-+-� -�-+-�-�-�-�-�, -�-+-�-�-� -+-+-�-+-�-+-+ -+-� -+-�-�-�-�-+
const defaultSideLogo = `${baseUrl}/side_logos/none.png`;
const defaultWinTypeLogo = `${baseUrl}/winType_logos/None.png`;
const defaultImage = `${baseUrl}/winType_logos/None.png`; // -�-+-� -�-+-+-�-+-�, -�-�-+-+ -+-� -+-�-�-�-�-+ -+-+-�-+-�-+-+
const defaultPlayerImage = `${baseUrl}/NoneP.png`;
// ------------------------------
// 1) -P-�-+-+-�-+-�-+-+-�-� -�-�-+-�-�-+-� -�-+-� -+-+-�-�-�-�-+-�-+-+-� -�-+-+--�-� -�-�-�-�-�-+-+-�-� -�-�-�-+-�-+-�
// ------------------------------
function getRoundCount() {
  let roundsFromWins = scoreboard.map && scoreboard.map.round_wins ? Object.keys(scoreboard.map.round_wins).length : 0;
  let roundsFromMap = scoreboard.map && scoreboard.map.round ? scoreboard.map.round : 0;
  // -�-�-+-+-+-�-+-�-�-+ -+-�-�-�-+-+-�-+-�-+-+-� -+-+-�-�-�-+-+-�, -�-�-+-�-� -�-+-�-�-�-�-�-+-+ -�-�-+-�-�-�-�-�-� -+-�-�-�-�-�-�-+
  return Math.max(roundsFromWins, roundsFromMap);
}

// ------------------------------
// 2) -�-�-+-�-�-+-� -�-+-� -+-+-�-�-�-�-�-� ADR (accumulatedDmg / -�-+-+-+-�-�-�-�-�-+_-�-�-�-�-�-+-+-�-�_-�-�-�-+-�-+-�)
// ------------------------------
function getAverageDamage(steamId) {
  const totalDamage = scoreboard.players[steamId]?.accumulatedDmg || 0;
  const roundsPlayed = getRoundCount();
  if (roundsPlayed > 0) {
    // -�-+-+-�-�-�-�-�-�-+ -+-+-�-�-�-+-+-� -�-�-� -�-�-�-+-�-� -� -+-�-+-+-+ -+-+-�-�-+-+ -+-+-�-+-� -+-�-+-�-�-+-�
    return (totalDamage / roundsPlayed).toFixed(1);
  }
  return "0.0";
}

// ------------------------------
// -�-�-+-�-�-+-� -�-�-�-+-�-+-�-+-+-� -+-�-+-�-+-�-+-�-+ ADR -�-+-� -�-�-�-� -+-�-�-+-�-+-�
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
// -�-�-+-+-+-+-�-�-�-�-+-�-+-�-� -�-�-+-�-�-+-� -�-+-� -+-+-+-�-�-�-+-+-� -+-+-�-+-�-+-+-� -�-+-+-�-+-�-� -+-+ -�-�-+-+-�-+ -+-�-�-+-�-�
// ------------------------------
function getTeamLogo(playerData) {
  let teamLogo = null;
  // -�-+-�-�-�-+-� -+-�-�-+ -+-�-�-+-�-� -� -�-�-+-� -�-+-� -+-+-+-�-�-�-+-+-� teamId
  const regPlayer = players.find(p => p.steamId?.toLowerCase() === playerData.steamid?.toLowerCase());
  if (regPlayer && regPlayer.teamId) {
    const teamObj = teams.find(t => t.id === regPlayer.teamId);
    if (teamObj && teamObj.logo) {
      teamLogo = `${baseUrl}${teamObj.logo}`;
    }
  }
  // -�-�-+-+ -+-� -+-�-�-+-+ -+-+ teamId, -+-�-�-�-�-+-�-� -+-�-�-�-+ -�-+-+-�-+-�-� -+-+ -+-+-�-+-+
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
// -�-�-+-�-�-+-� -�-+-� -�-+-�-+-+-�-+-�-�-+-+-� -�-�-+-+-�-� -+-�-�-+-�-�-�-�-+-+-�-+ -+-�-�-+-�-�
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
// WebSocket -�-+-� -+-�-+-+-�-+-�-+-+-� -�-�-+-+-�-� -+-�-�-+-�-�-�-�-�-+-� -� -�-�-�-+-�-+-+-+ -�-�-�-+-�-+-+
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
  console.log('WebSocket--�-+-�-�-+-+-�-+-+-� -�-�-�-�-+-+-�-+-�-+-+');
  ws.send(JSON.stringify([getObserverData()]));
  
  // -�-�-+-�-�-�-+ -+-+-�-�-�-�-�-+, -+-�-+-+-�-+-�-+-+-� -�-�-�-�-� -+-+ GSI POST
  // const intervalId = setInterval(() => {
  //   if (ws.readyState === WebSocket.OPEN) {
  //     ws.send(JSON.stringify([getObserverData()]));
  //   }
  // }, 1000);
  
  ws.on('close', () => {
    // clearInterval(intervalId); // -�-+-+-�-�-�-�-�-�-�-�-+-+-+, -�-�-+ -�-+-�-� -�-�-+-�-�-�-+
    console.log('WebSocket--�-+-�-�-+-+-�-+-+-� -+-�-�-�-�-�-+');
  });
});

// ------------------------------
// -�-�-+-�-�-+-� -�-+-� -�-+-�-+-+-�-+-�-�-+-+-� -+-+-�-+-�-+-�-�-+-+ -+ -�-�-�-+-�-�
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
      
      // -�-+-� -+-�-�-�-�-� 12 -�-�-�-+-�-+-� -+-�-+-+-+-�-+-�-�-+ -+-�-+-�-+-+-�-+-�-+-+-� -�-�-�-+-�-�-�-�-+-�-+-+-�
      if (roundNumber <= 12) { // -�-�-�-� -+-�-+-�-+-+-�-+-�-+-�-� -+-+-�-+-�-�
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
        // -�-+-� -�-�-�-+-�-+-� -� 13--�-+ -+-�-+-+-+-�-+-�-�-+ -�-�-�-�-�-+-� -�-�-+-+-�-�
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
// -P-�-�-�-�-+-�-�-+-� -�-�-+-+-�-� GSI -+-� CS:GO/CS2 (POST "/")
// ------------------------------
app.post('/', (req, res) => {
  const data = req.body;
  lastScoreboardUpdate = new Date().toISOString();
  if (!data) {
    return res.status(400).json({ error: "-�-�-� -+-+-+-�-�-�-+-+-�-� -�-�-+-+-�-� -� -�-+-�-+-�-�-� JSON" });
  }
  
  if (data.map && data.map.round === 1) { // -�-�-+-+ data.map.round === 1, -+-�-�-�-�-+-�-�-+ -�-�-� -�-�-�-�
    const finalStats = computeFinalADR();
    console.log("-�-�-�-� -+-�-�-�-�-�-�-+. -�-�-+-�-+-�-�-� ADR:", finalStats);
    scoreboard.players = {};
    roundsHistory = [];
    roundsAlive = [];
    // ??????? ???? ?????, ???? ??? ????? ????? ??????
    currentMatchKey = buildMatchKey(data.map);
    // scoreboard.map = {}; // -�-�-+ -+-+-�-�-� -�-�-�-� -�-+-+-�-�-+-+ -�-�-+-+, -�-�-+-+ -�-�-� -+-�-�-+-� original_team_ct/t
  }
  
  if (data.map) {
    if (!scoreboard.map.name || scoreboard.map.name !== data.map.name) {
      console.log("-�-+-�-�-� -�-�-�-�-�:", data.map.name, "G�� -�-�-+-+-+-+-�-�-�-�-� -�-�-�-+-� -�-�-+-+-�-�");
      if (scoreboard.map.name) { // -�-�-+-+ -+-�-�-�-�-�-�-�-�-� -�-�-�-�-� -�-�-+-�
        const finalStats = computeFinalADR();
        console.log("-�-�-+-�-+-�-�-� ADR -+-�-�-�-�-�-�-+-+-+-�-+ -+-�-�-�-�:", finalStats);
      }
      scoreboard.players = {}; // -�-�-�-�-�-�-�-�-�-+ -+-�-�-+-�-+-� -+-�-+ -�-+-�-+-� -�-�-�-�-�
      roundsHistory = [];
      roundsAlive = [];
      // scoreboard.map = {}; // -�-�-�-�-�-�-�-�-�-+ -�-�-�-�-�
      // -�-�-+ -+-+-�-+-+ -+-�-�-�-� -+-�-+-�-+-+-�-+-�-+-+-� -�-�-�-+-�-�-�-�-+-�-+-+-� -�-+-�-+-�-�-�-�-� -� -�-�-�-�-�-+-+
      scoreboard.map = { // -�-�-�-�-+-�-�-+-+-�-�-�-+ -+-+-�-�-� -�-�-�-�-� -+ -+-�-+-�-+-+-�-+-�-+-�-� -�-+-+-�-+-�-�
        ...data.map,
        original_team_ct: data.map.team_ct ? {...data.map.team_ct} : null, // -�-+-+-+-�-�-�-+ -+-�-�-�-�-�-�
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
      
      // -�-�-�-� -+-�-+-�-+-+-�-+-�-+-�-� -+-+-�-+-�-� ADR:
      const roundDmgNow = newPlayerData?.state?.round_totaldmg || 0;
      const roundDmgPrev = scoreboard.players[steamId].previousRoundDmg || 0;
      if (roundDmgNow < roundDmgPrev) { // -�-�-�-+-�, -�-�-+-+ -+-+-�-�-� -�-�-+-+ -+-�-+-�-�-� -+-�-�-�-�-�-�-�-�-�-+ (-+-�-�-�-+-+ -+-+-�-+-�-+ -�-�-�-+-�-�)
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
  
  if (data.player) { // -P-�-�-�-�-+-�-�-� -�-�-+-+-�-� -+-�-�-+-�-�-�-�-+-+-�-+ -+-�-�-+-�-�, -�-�-+-+ -+-+-+ -+-� -� allplayers
    scoreboard.player = data.player;
    const pSteam = data.player.steamid;
    if (pSteam && (!data.allplayers || !data.allplayers[pSteam])) {
      if (!scoreboard.players[pSteam]) {
        scoreboard.players[pSteam] = { accumulatedDmg: 0, previousRoundDmg: 0 };
      }
      scoreboard.players[pSteam] = { ...scoreboard.players[pSteam], ...data.player };
      // -�-�-�-� -+-�-+-�-+-+-�-+-�-+-�-� -+-+-�-+-�-� ADR -�-+-� data.player:
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
  
  console.log("-�-+-+-�-�-�-+-� -�-�-+-+-�-� GSI (-�-�-�-�-�):", JSON.stringify(data, null, 2).substring(0, 300) + "...");

  if (scoreboard.map && scoreboard.map.round_wins) {
    // -P-�-�-�-�-+-�-�-+ -�-�-�-� -+-+-�-+-�-� -�-+-� roundsHistory
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
    // -P-�-�-�-�-+-�-�-+ -�-�-�-� -+-+-�-+-�-� -�-+-� roundsAlive
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
  res.status(200).json({ message: "-�-�-+-+-�-� -+-+-+-�-�-�-+-�" });
});

// ------------------------------
// -�-�-+-�-+-� endpoints (REST API)
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
  const mapInfo = { CT: teamCT, T: teamT }; // -�-�-+-+-+-�-+-�-�-+ -+-+-+-+-�-� -+-�-�-�-�-�-�
  const playersArr = [
    ...ctPlayers.map(p => ({ ...p, teamName: teamCT.name })), // -�-+-�-�-�-+-�-�-+ teamName
    ...tPlayers.map(p => ({ ...p, teamName: teamT.name }))  // -�-+-�-�-�-+-�-�-+ teamName
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
  const totalRounds = 24; // -�-�-�-� -+-�-+-�-+-+-�-+-�-+-+-� -+-+-�-�-�-+-+-�
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
    let player = { ...scoreboard.players[steamId] }; // -�-�-+-+-�-� -+-+ GSI
    const regPlayer = players.find(p => p.steamId?.toLowerCase() === steamId.toLowerCase()); // -�-�-+-+-�-� -+-+ -�-�-�-�-� -�-�-+-+-+-�-+

    const name = regPlayer?.name || player.name; // -�-�-+-+-�-+-�-�-� -+-+-�-+-+ -+-+ -�-�-+-+-+-�-+
    const photoFromReg = regPlayer?.photo; // -�-+-�-+ -+-+ -�-�-+-+-+-�-+

    const team = player.team;
    if (team === "CT" || team === "T") {
      const kills = player.match_stats?.kills || 0;
      const assists = player.match_stats?.assists || 0;
      const adrNum = parseFloat(getAverageDamage(steamId));
      
      const scoreValue = kills + assists + adrNum; // -�-�-�-� -+-�-+-�-+-+-�-+-�-+-�-� -�-+-�-+-�-+-� MVP
      
      if (scoreValue > mvpScore && roundsPlayed > 0) { // MVP -�-+-+-�-�-+ -�-�-+-+ -�-�-+-+ -�-�-�-�-�-+-� -�-�-�-+-�-�
        mvpScore = scoreValue;
        const photoFull = photoFromReg ? `${baseUrl}${photoFromReg.startsWith('/') ? '' : '/'}${photoFromReg}` : defaultPlayerImage;
        
        let team_logo = defaultImage; // -�-�-+-+-+-�-+-�-�-+ defaultImage -+-+ -�-+-+-+-�-�-+-+-�
        let team_name = "";

        // -�-+-�-+-�-� -+-+-�-�-�-�-+-�-+-+-� -+-+-�-+-+ -�-+-+-�-+-�-� -+ -+-+-�-+-�-+-+-� -+-+ -�-�-�-�-�-+ -+-�-+-�-+-+-�-+-�-+-+-�-+ -�-+-�-�
        if (regPlayer && regPlayer.teamId) {
          const teamObj = teams.find(t => t.id === regPlayer.teamId);
          if (teamObj) {
            team_logo = teamObj.logo ? `${baseUrl}${teamObj.logo}` : defaultImage;
            team_name = teamObj.name;
          }
        }
        if (!team_name) { // -�-�-+-+ -+-+ teamId -+-� -+-�-�-+-+ -+-+-+ regPlayer -+-�-�
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
            team_name = actualTeamName; // -�-�-+-+ -+ -+-+ -+-+-�-+-+ -+-� -+-�-�-+-+, -�-�-�-�-+ "CT" -+-+-+ "T"
          }
        }
        
        mvp = { 
          steamId, name, team, team_name, kills, assists, 
          deaths: player.match_stats?.deaths || 0, adr: adrNum, 
          mvpScore, // -�-�-+-+ mvpScore: scoreValue, -+-+-+-�-+-+-+ -+-� mvpScore -�-+-� -�-+-+-�-+-�-�-�-+-�-+-+-�-�-+
          photo: photoFull, team_logo,
          // -�-�-�-� -+-�-+-�-+-+-�-+-�-+-�-� -�-�-�-�-+-�-�-+-�-�
          kdRatio: parseFloat(player.match_stats?.deaths > 0 ? (kills / player.match_stats.deaths).toFixed(2) : kills.toFixed(2)),
          kpr: parseFloat(roundsPlayed > 0 ? (kills / roundsPlayed).toFixed(2) : "0.00"),
          kda: parseFloat(player.match_stats?.deaths > 0 ? ((kills + assists) / player.match_stats.deaths).toFixed(2) : (kills + assists).toFixed(2)),
          plusMinus: kills - (player.match_stats?.deaths || 0),
          totalDMG: player.accumulatedDmg || 0, // -�-�-+-+-+-�-+-�-�-+ accumulatedDmg
          kast: player.match_stats?.kast ?? "N/A", // -�-�-+-+-+-�-+-�-�-+ ?? -�-+-� N/A
          dpr: parseFloat(adrNum.toFixed(2)), // -�-�-+ -�-+ -�-�, -�-�-+ -+ adr, -+-+ -� toFixed
          hsPercent: parseFloat(kills > 0 && player.match_stats?.headshots ? ((player.match_stats.headshots / kills) * 100).toFixed(2) : "0.00"),
          headshots: player.match_stats?.headshots || 0,
          accuracy: player.match_stats?.shots > 0 && player.match_stats?.hits ? ((player.match_stats.hits / player.match_stats.shots) * 100).toFixed(2) : "N/A"
        };
      }
    }
  }
  res.json(mvp ? [mvp] : []); // -�-+-+-�-�-�-�-�-�-+ -+-�-�-�-+-�
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
// === -�-�-�-�-�-P -�-�-�-�-�-� API -�-�-� CRUD ===
// ==================================

// --- API -�-+-� -�-+-+-�-+-� ---
app.get('/api/teams', (req, res) => {
  const base = req.protocol + '://' + req.get('host');
  const result = teams.map(t => ({ ...t, logo: t.logo && t.logo.startsWith('/') ? base + t.logo : t.logo }));
  res.json(result);
});

// -�-P-�-�-�-�-�-�-�-�-� -�-�-�-�-�-�-� -�-�-� -�-P-�-�-�-�-�-�-� -P-�-�-P-� -�-P-�-�-�-�-�
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
  teams = teams.filter(t => t.id !== id); // -�-�-+-+-+-�-+-�-�-+ filter, -�-�-� -� -�-�-�-�-+ -+-�-+-�-+-+-�-+-�
  if (teams.length < originalLength) {
    players = players.map(p => p.teamId === id ? { ...p, teamId: null } : p);
    saveData();
    res.status(200).json({ message: "Team deleted" }); // -�-�-�-�-�-� 200
  } else {
    res.status(404).json({ error: "Team not found" });
  }
});

app.post('/api/teams/uploadLogo', uploadTeams.single('logoFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = '/logos/' + req.file.filename;
  res.json({ path: filePath });
});

// --- API -�-+-� -+-�-�-+-�-+-� ---
app.get('/api/players', (req, res) => {
  const base = req.protocol + '://' + req.get('host');
  const result = players.map(p => ({ ...p, photo: p.photo && p.photo.startsWith('/') ? base + p.photo : p.photo }));
  res.json(result);
});

// -�-P-�-�-�-�-�-�-�-�-� -�-�-�-�-�-�-� -�-�-� -�-P-�-�-�-�-�-�-� -P-�-�-P-�-P -�-�-�-P-�-�
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
  const { name, steamId, photo, teamId, match_stats } = req.body; // -P-�-�-�-�-+-+ match_stats
  if (!name) return res.status(400).json({error: "Player name is required"});
  const newPlayer = { 
    id: Date.now().toString(), name, steamId: steamId || null, 
    photo: photo || null, teamId: teamId || null, 
    match_stats: match_stats || {} // -�-+-+-�-+-�-+-+-+-+-�-�-�-+, -�-�-� -� -�-�-�-�-+ -+-�-+-�-+-+-�-+-�
  };
  players.push(newPlayer);
  saveData();
  res.status(201).json(newPlayer); // -�-�-�-�-�-� 201
});

app.put('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const { name, steamId, photo, teamId, match_stats } = req.body; // -P-�-�-�-�-+-+ match_stats
  const playerIndex = players.findIndex(p => p.id === id); // -�-�-+-+-+-�-+-�-�-+ findIndex
  if (playerIndex === -1) return res.status(404).json({ error: "Player not found" });
  
  players[playerIndex].name = name !== undefined ? name : players[playerIndex].name;
  players[playerIndex].steamId = steamId !== undefined ? (steamId || null) : players[playerIndex].steamId;
  players[playerIndex].photo = photo !== undefined ? (photo || null) : players[playerIndex].photo;
  players[playerIndex].teamId = teamId !== undefined ? (teamId || null) : players[playerIndex].teamId;
  players[playerIndex].match_stats = match_stats !== undefined ? (match_stats || {}) : players[playerIndex].match_stats;
  saveData();
  res.json(players[playerIndex]);
});

app.delete('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const originalLength = players.length;
  players = players.filter(p => p.id !== id); // -�-�-+-+-+-�-+-�-�-+ filter, -�-�-� -� -�-�-�-�-+ -+-�-+-�-+-+-�-+-�
  if (players.length < originalLength) {
    saveData();
    res.status(200).json({ message: "Player deleted" }); // -�-�-�-�-�-� 200
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

// GET /api/export/teams � ??? ??????? + ?????????? + ????? + VRS
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

// GET /api/export/players � ??? ?????? + ?????? ??????????
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

// GET /api/stats/match � ??????? ????
app.get('/api/stats/match', (req, res) => {
  const match = stats.getCurrentMatchStats();
  if (!match) return res.json({ status: 'no_match', data: null });
  res.json({ status: 'live', data: match });
});

// GET /api/stats/players � ?????????? ??????? ???????
app.get('/api/stats/players', (req, res) => {
  res.json(stats.getGlobalPlayerRatings(players));
});

// GET /api/stats/teams � ?????????? ??????? ??????
app.get('/api/stats/teams', (req, res) => {
  res.json(stats.getGlobalTeamRatings(teams));
});

// GET /api/stats/history � ??????? ??????
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

// GET /api/stats/history/:id � ???? ???? ?? ???????
app.get('/api/stats/history/:id', (req, res) => {
  const match = stats.getMatchHistory().find(m => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  res.json(match);
});

// DELETE /api/stats/history/:id � ??????? ???? ? ??????????? ?????????? ??????????
app.delete('/api/stats/history/:id', (req, res) => {
  const ok = stats.deleteMatch(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Match not found' });
  res.json({ ok: true });
});

// GET /api/stats/global � ????? ??????????? ??????
app.get('/api/stats/global', (req, res) => {
  res.json(stats.getGlobalStats());
});

// GET /api/stats/maps � ?????????? ?? ??????
app.get('/api/stats/maps', (req, res) => {
  res.json(stats.getMapStats());
});

// GET /api/stats/player/:steamId � ??????? ??????
app.get('/api/stats/player/:steamId', (req, res) => {
  const data = stats.getPlayerStats(req.params.steamId, players);
  if (!data) return res.status(404).json({ error: 'Player not found' });
  res.json(data);
});

// GET /api/stats/team/:name � ??????? ???????
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
 * ??? rowIndex � 0-based ?????? ?????? ? drawing (0 = ?????????, 1 = ?????? ?????? ??????).
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

// POST /api/import/teams � ?????? ?????? ?? xlsx
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

// POST /api/import/players � ?????? ??????? ?? xlsx
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
        match_stats: {}
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
// === -�-P-�-�-� -�-�-�-�-�-� API -�-�-� CRUD ===
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

    // Collect all players (up to 10)
    const playersData = [];
    let ctCount = 0, tCount = 0;

    for (const steamId in scoreboard.players) {
      const gsiPlayer = scoreboard.players[steamId];
      const side = gsiPlayer.team;

      if (side === 'CT') ctCount++;
      if (side === 'T') tCount++;

      // Skip if we already have 5 from this side (10 total max)
      if ((side === 'CT' && ctCount > 5) || (side === 'T' && tCount > 5)) continue;

      // Resolve player profile
      const regPlayer = graphicsUtils.resolvePlayerBySteamId(steamId, players);
      const playerProfile = {
        id: regPlayer?.id || `temp_${steamId}`,
        steamId: steamId,
        name: regPlayer?.name || gsiPlayer.name || 'Unknown',
        nickname: regPlayer?.nickname || gsiPlayer.name || 'Unknown',
        photo: graphicsUtils.resolvePlayerPhoto(regPlayer, baseUrl),
        teamId: regPlayer?.teamId || null,
        teamName: side === 'CT' ? teamCT.name : teamT.name,
        teamLogo: side === 'CT' ? teamAProfile.logo : teamBProfile.logo,
        side: side,
        kills: gsiPlayer.match_stats?.kills || 0,
        assists: gsiPlayer.match_stats?.assists || 0,
        deaths: gsiPlayer.match_stats?.deaths || 0,
        adr: parseFloat(getAverageDamage(steamId)),
        damage: gsiPlayer.state?.damage || gsiPlayer.accumulatedDmg || 0,
        kd: graphicsUtils.calculateKD(gsiPlayer.match_stats?.kills || 0, gsiPlayer.match_stats?.deaths || 0),
        isAlive: gsiPlayer.state?.health > 0,
        health: gsiPlayer.state?.health || 0,
        armor: gsiPlayer.state?.armor || 0,
        money: gsiPlayer.state?.money || 0,
        weapon: gsiPlayer.state?.primary_weapon || gsiPlayer.state?.secondary_weapon || null
      };

      playersData.push(playerProfile);
    }

    // Sort by kills
    playersData.sort((a, b) => b.kills - a.kills);

    // Prepare response
    const response = {
      mode: 'live',
      matchId: null,
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

      players: playersData,

      teams: {
        teamAPlayers: playersData.filter(p => p.side === 'CT'),
        teamBPlayers: playersData.filter(p => p.side === 'T'),
        ctPlayers: playersData.filter(p => p.side === 'CT'),
        tPlayers: playersData.filter(p => p.side === 'T')
      },

      topPlayers: {
        kills: playersData.slice(0, 3),
        adr: [...playersData].sort((a, b) => b.adr - a.adr).slice(0, 3),
        damage: [...playersData].sort((a, b) => b.damage - a.damage).slice(0, 3)
      }
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
    const teamsData = teams.map(team => {
      // Get players in this team
      const teamPlayers = players.filter(p => p.teamId === team.id).map(p => ({
        id: p.id,
        steamId: p.steamId,
        name: p.name,
        nickname: p.nickname || p.name,
        photo: graphicsUtils.resolvePlayerPhoto(p, baseUrl)
      }));

      return {
        id: team.id,
        name: team.name,
        shortName: team.shortName || team.name.substring(0, 3).toUpperCase(),
        logo: graphicsUtils.resolveLogo(team, baseUrl),
        country: team.country || '',
        players: teamPlayers,
        stats: {
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          mapsPlayed: 0,
          mapsWon: 0,
          mapsLost: 0,
          mapWinRate: 0
        },
        mapStats: {},
        lastMatches: []
      };
    });

    res.json({
      teams: teamsData,
      updatedAt: new Date().toISOString()
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
 * Phase 3 endpoint
 */
app.get('/api/graphics/prematch', (req, res) => {
  try {
    const { teamA: teamAId, teamB: teamBId } = req.query;

    if (!teamAId || !teamBId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'Please provide teamA and teamB query parameters'
      });
    }

    const teamA = teams.find(t => t.id === teamAId);
    const teamB = teams.find(t => t.id === teamBId);

    if (!teamA || !teamB) {
      return res.status(404).json({ error: 'One or both teams not found' });
    }

    // Helper function to build team profile
    const buildTeamProfile = (team) => {
      const teamPlayers = players.filter(p => p.teamId === team.id).map(p => ({
        id: p.id,
        steamId: p.steamId,
        name: p.name,
        nickname: p.nickname || p.name,
        photo: graphicsUtils.resolvePlayerPhoto(p, baseUrl)
      }));

      return {
        id: team.id,
        name: team.name,
        shortName: team.shortName || team.name.substring(0, 3).toUpperCase(),
        logo: graphicsUtils.resolveLogo(team, baseUrl),
        players: teamPlayers,
        stats: {
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          mapsPlayed: 0,
          mapsWon: 0,
          mapsLost: 0,
          mapWinRate: 0
        },
        mapStats: {},
        lastMatches: []
      };
    };

    const response = {
      mode: 'prematch',
      updatedAt: new Date().toISOString(),

      teamA: buildTeamProfile(teamA),
      teamB: buildTeamProfile(teamB),

      headToHead: {
        matchesPlayed: 0,
        teamAWins: 0,
        teamBWins: 0,
        recentMatches: [],
        mapBreakdown: {}
      },

      maps: {}
    };

    res.json(response);
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
    
    if (fs.existsSync(POSTMATCH_FILE)) {
      const postmatch = JSON.parse(fs.readFileSync(POSTMATCH_FILE, 'utf8'));
      res.json(postmatch);
    } else {
      res.json(getIdlePostmatch());
    }
  } catch (err) {
    console.error('Error in /api/graphics/postmatch:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
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
// -�-�-+-�-�-� -�-�-�-�-�-�-� (Express + WebSocket)
// ------------------------------
server.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on ${baseUrl} (HTTP and WebSocket on port ${port})`);
});


