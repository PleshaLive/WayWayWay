const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors'); // <--- ╨ú╨▒╨╡╨┤╨╕╤é╨╡╤ü╤î, ╤ç╤é╨╛ ╤ì╤é╨░ ╤ü╤é╤Ç╨╛╨║╨░ ╨╡╤ü╤é╤î
const xlsx = require('xlsx');

const app = express();
const port = process.env.PORT || 2727;

// Middleware ╨┤╨╗╤Å ╨┐╨░╤Ç╤ü╨╕╨╜╨│╨░ JSON ╨╕ URL-encoded ╨┤╨░╨╜╨╜╤ï╤à
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ╨Æ╨║╨╗╤Ä╤ç╨╕╤é╨╡ CORS ╨┤╨╗╤Å ╨▓╤ü╨╡╤à ╨╝╨░╤Ç╤ê╤Ç╤â╤é╨╛╨▓
app.use(cors()); // <--- ╨ú╨▒╨╡╨┤╨╕╤é╨╡╤ü╤î, ╤ç╤é╨╛ ╤ì╤é╨░ ╤ü╤é╤Ç╨╛╨║╨░ ╨╡╤ü╤é╤î

// ╨í╤é╨░╤é╨╕╤ç╨╡╤ü╨║╨╕╨╡ ╤ä╨░╨╣╨╗╤ï (╨╗╨╛╨│╨╛╤é╨╕╨┐╤ï, ╤ä╨╛╤é╨╛ ╨╕ ╤é.╨┤.)
app.use(express.static(path.join(__dirname, 'public')));

// ╨ƒ╤â╤é╤î ╨║ ╤ä╨░╨╣╨╗╤â ╨┤╨╗╤Å ╤à╤Ç╨░╨╜╨╡╨╜╨╕╤Å ╨┤╨░╨╜╨╜╤ï╤à (persistent storage)
const DATA_FILE = path.join(__dirname, 'data.json');

// ╨ö╨░╨╜╨╜╤ï╨╡ ╨┤╨╗╤Å ╨░╨┤╨╝╨╕╨╜╨║╨╕ ΓÇô ╨║╨╛╨╝╨░╨╜╨┤╤ï ╨╕ ╨╕╨│╤Ç╨╛╨║╨╕ (persistent storage)
let teams = [];      // ╨₧╨▒╤è╨╡╨║╤é╤ï: { id, name, logo, score }
let players = [];  // ╨₧╨▒╤è╨╡╨║╤é╤ï: { id, name, steamId, photo, teamId, match_stats }

// ╨₧╨▒╤è╨╡╨║╤é scoreboard ╨┤╨╗╤Å ╨┤╨░╨╜╨╜╤ï╤à GSI (╨╛╤é CS:GO/CS2)
let scoreboard = {
  players: {},
  map: {},
  player: {}
};

// ╨ô╨╗╨╛╨▒╨░╨╗╤î╨╜╨░╤Å ╨┐╨╡╤Ç╨╡╨╝╨╡╨╜╨╜╨░╤Å ╨┤╨╗╤Å ╤à╤Ç╨░╨╜╨╡╨╜╨╕╤Å ╨╕╤ü╤é╨╛╤Ç╨╕╨╕ ╤Ç╨░╤â╨╜╨┤╨╛╨▓
let roundsHistory = [];
let roundsAlive = [];

// Трекер текущего матча (по именам команд, независимо от сторон), чтобы сбрасывать историю при смене матчапа на той же карте
let currentMatchKey = null;

function buildMatchKey(mapObj) {
  if (!mapObj) return null;
  const ctName = (mapObj.team_ct?.name || 'CT').toLowerCase();
  const tName = (mapObj.team_t?.name || 'T').toLowerCase();
  // Сортируем, чтобы не зависеть от сторон после смены половин
  return [ctName, tName].sort().join(' vs ');
}

// ------------------------------
// ╨ñ╤â╨╜╨║╤å╨╕╤Å ╨╖╨░╨│╤Ç╤â╨╖╨║╨╕ ╨┤╨░╨╜╨╜╤ï╤à ╨╕╨╖ data.json
// ------------------------------
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const jsonData = JSON.parse(raw);
      teams = jsonData.teams || [];
      players = jsonData.players || [];
      console.log("╨ö╨░╨╜╨╜╤ï╨╡ ╨╖╨░╨│╤Ç╤â╨╢╨╡╨╜╤ï ╨╕╨╖ data.json");
    } catch (err) {
      console.error("╨₧╤ê╨╕╨▒╨║╨░ ╨┐╤Ç╨╕ ╤ç╤é╨╡╨╜╨╕╨╕ data.json:", err);
      teams = [];
      players = [];
    }
  } else {
    console.log("╨ñ╨░╨╣╨╗ data.json ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜, ╨╜╨░╤ç╨╕╨╜╨░╨╡╨╝ ╤ü ╨┐╤â╤ü╤é╤ï╤à ╨┤╨░╨╜╨╜╤ï╤à");
  }
}

// ╨ñ╤â╨╜╨║╤å╨╕╤Å ╤ü╨╛╤à╤Ç╨░╨╜╨╡╨╜╨╕╤Å ╨┤╨░╨╜╨╜╤ï╤à ╨▓ data.json
function saveData() {
  const jsonData = { teams, players };
  fs.writeFileSync(DATA_FILE, JSON.stringify(jsonData, null, 2), 'utf8');
  console.log("╨ö╨░╨╜╨╜╤ï╨╡ ╤ü╨╛╤à╤Ç╨░╨╜╨╡╨╜╤ï ╨▓ data.json");
}

// ╨ù╨░╨│╤Ç╤â╨╢╨░╨╡╨╝ ╨┤╨░╨╜╨╜╤ï╨╡ ╨┐╤Ç╨╕ ╤ü╤é╨░╤Ç╤é╨╡ ╤ü╨╡╤Ç╨▓╨╡╤Ç╨░
loadData();

// ------------------------------
// ╨¥╨░╤ü╤é╤Ç╨╛╨╣╨║╨░ Multer ╨┤╨╗╤Å ╨╖╨░╨│╤Ç╤â╨╖╨║╨╕ ╨╗╨╛╨│╨╛╤é╨╕╨┐╨╛╨▓ ╨║╨╛╨╝╨░╨╜╨┤
// ------------------------------
const storageTeams = multer.diskStorage({
  destination: function (req, file, cb) {
    // Папка для логотипов команд
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
// ╨¥╨░╤ü╤é╤Ç╨╛╨╣╨║╨░ Multer ╨┤╨╗╤Å ╨╖╨░╨│╤Ç╤â╨╖╨║╨╕ ╤ä╨╛╤é╨╛╨│╤Ç╨░╤ä╨╕╨╣ ╨╕╨│╤Ç╨╛╨║╨╛╨▓
// ------------------------------
const storagePlayers = multer.diskStorage({
  destination: function (req, file, cb) {
    // Папка для фото игроков
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
// Настройка Multer для импорта xlsx файлов (в памяти)
// ------------------------------
const uploadXlsx = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только файлы .xlsx и .xls'), false);
    }
  }
});

function fixUrl(url) {
  if (!url) return url; // ╨ò╤ü╨╗╨╕ URL ╨┐╤â╤ü╤é╨╛╨╣, ╨▓╨╛╨╖╨▓╤Ç╨░╤ë╨░╨╡╨╝ ╨║╨░╨║ ╨╡╤ü╤é╤î
  if ((url.startsWith("http:/") && !url.startsWith("http://")) ||
      (url.startsWith("https:/") && !url.startsWith("https://"))) {
    return url.replace(/^https?:\//, match => match + '/');
  }
  return url;
}


// ------------------------------
// ╨ƒ╤Ç╨╡╨┤╨╛╨┐╤Ç╨╡╨┤╨╡╨╗╤æ╨╜╨╜╤ï╨╡ ╨┐╤â╤é╨╕ ╨┤╨╗╤Å Side_logo ╨╕ winType_logo
// ------------------------------
// ╨₧╨┐╤Ç╨╡╨┤╨╡╨╗╨╡╨╜╨╕╨╡ baseUrl ╨┤╨╛╨╗╨╢╨╜╨╛ ╨▒╤ï╤é╤î ╨┤╨╕╨╜╨░╨╝╨╕╤ç╨╡╤ü╨║╨╕╨╝ ╨╕╨╗╨╕ ╨╕╨╖ ╨┐╨╡╤Ç╨╡╨╝╨╡╨╜╨╜╤ï╤à ╨╛╨║╤Ç╤â╨╢╨╡╨╜╨╕╤Å
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

// ╨ö╨╡╤ä╨╛╨╗╤é╨╜╤ï╨╡ ╨╕╨╖╨╛╨▒╤Ç╨░╨╢╨╡╨╜╨╕╤Å ╨┤╨╗╤Å ╤ü╨╗╤â╤ç╨░╨╡╨▓, ╨║╨╛╨│╨┤╨░ ╨╗╨╛╨│╨╛╤é╨╕╨┐ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜
const defaultSideLogo = `${baseUrl}/side_logos/none.png`;
const defaultWinTypeLogo = `${baseUrl}/winType_logos/None.png`;
const defaultImage = `${baseUrl}/winType_logos/None.png`; // ╨┤╨╗╤Å ╨║╨╛╨╝╨░╨╜╨┤, ╨╡╤ü╨╗╨╕ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜ ╨╗╨╛╨│╨╛╤é╨╕╨┐
const defaultPlayerImage = `${baseUrl}/NoneP.png`;
// ------------------------------
// 1) ╨₧╨▒╨╜╨╛╨▓╨╗╤æ╨╜╨╜╨░╤Å ╤ä╤â╨╜╨║╤å╨╕╤Å ╨┤╨╗╤Å ╨╛╨┐╤Ç╨╡╨┤╨╡╨╗╨╡╨╜╨╕╤Å ╨║╨╛╨╗-╨▓╨░ ╤ü╤ï╨│╤Ç╨░╨╜╨╜╤ï╤à ╤Ç╨░╤â╨╜╨┤╨╛╨▓
// ------------------------------
function getRoundCount() {
  let roundsFromWins = scoreboard.map && scoreboard.map.round_wins ? Object.keys(scoreboard.map.round_wins).length : 0;
  let roundsFromMap = scoreboard.map && scoreboard.map.round ? scoreboard.map.round : 0;
  // ╨ÿ╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ ╨╝╨░╨║╤ü╨╕╨╝╨░╨╗╤î╨╜╨╛╨╡ ╨╖╨╜╨░╤ç╨╡╨╜╨╕╨╡, ╤ç╤é╨╛╨▒╤ï ╨║╨╛╤Ç╤Ç╨╡╨║╤é╨╜╨╛ ╤â╤ç╨╕╤é╤ï╨▓╨░╤é╤î ╨╛╨▓╨╡╤Ç╤é╨░╨╣╨╝
  return Math.max(roundsFromWins, roundsFromMap);
}

// ------------------------------
// 2) ╨ñ╤â╨╜╨║╤å╨╕╤Å ╨┤╨╗╤Å ╨┐╨╛╨┤╤ü╤ç╤æ╤é╨░ ADR (accumulatedDmg / ╨║╨╛╨╗╨╕╤ç╨╡╤ü╤é╨▓╨╛_╤ü╤ï╨│╤Ç╨░╨╜╨╜╤ï╤à_╤Ç╨░╤â╨╜╨┤╨╛╨▓)
// ------------------------------
function getAverageDamage(steamId) {
  const totalDamage = scoreboard.players[steamId]?.accumulatedDmg || 0;
  const roundsPlayed = getRoundCount();
  if (roundsPlayed > 0) {
    // ╨Æ╨╛╨╖╨▓╤Ç╨░╤ë╨░╨╡╨╝ ╨╖╨╜╨░╤ç╨╡╨╜╨╕╨╡ ╨║╨░╨║ ╤ü╤é╤Ç╨╛╨║╤â ╤ü ╨╛╨┤╨╜╨╕╨╝ ╨╖╨╜╨░╨║╨╛╨╝ ╨┐╨╛╤ü╨╗╨╡ ╨╖╨░╨┐╤Å╤é╨╛╨╣
    return (totalDamage / roundsPlayed).toFixed(1);
  }
  return "0.0";
}

// ------------------------------
// ╨ñ╤â╨╜╨║╤å╨╕╤Å ╨▓╤ï╤ç╨╕╤ü╨╗╨╡╨╜╨╕╤Å ╨╕╤é╨╛╨│╨╛╨▓╨╛╨│╨╛ ADR ╨┤╨╗╤Å ╨▓╤ü╨╡╤à ╨╕╨│╤Ç╨╛╨║╨╛╨▓
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
// ╨Æ╤ü╨┐╨╛╨╝╨╛╨│╨░╤é╨╡╨╗╤î╨╜╨░╤Å ╤ä╤â╨╜╨║╤å╨╕╤Å ╨┤╨╗╤Å ╨┐╨╛╨╗╤â╤ç╨╡╨╜╨╕╤Å ╨╗╨╛╨│╨╛╤é╨╕╨┐╨░ ╨║╨╛╨╝╨░╨╜╨┤╤ï ╨┐╨╛ ╨┤╨░╨╜╨╜╤ï╨╝ ╨╕╨│╤Ç╨╛╨║╨░
// ------------------------------
function getTeamLogo(playerData) {
  let teamLogo = null;
  // ╨í╨╜╨░╤ç╨░╨╗╨░ ╨╕╤ë╨╡╨╝ ╨╕╨│╤Ç╨╛╨║╨░ ╨▓ ╨▒╨░╨╖╨╡ ╨┤╨╗╤Å ╨┐╨╛╨╗╤â╤ç╨╡╨╜╨╕╤Å teamId
  const regPlayer = players.find(p => p.steamId?.toLowerCase() === playerData.steamid?.toLowerCase());
  if (regPlayer && regPlayer.teamId) {
    const teamObj = teams.find(t => t.id === regPlayer.teamId);
    if (teamObj && teamObj.logo) {
      teamLogo = `${baseUrl}${teamObj.logo}`;
    }
  }
  // ╨ò╤ü╨╗╨╕ ╨╜╨╡ ╨╜╨░╤ê╨╗╨╕ ╨┐╨╛ teamId, ╨┐╤ï╤é╨░╨╡╨╝╤ü╤Å ╨╜╨░╨╣╤é╨╕ ╨║╨╛╨╝╨░╨╜╨┤╤â ╨┐╨╛ ╨╕╨╝╨╡╨╜╨╕
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
// ╨ñ╤â╨╜╨║╤å╨╕╤Å ╨┤╨╗╤Å ╤ä╨╛╤Ç╨╝╨╕╤Ç╨╛╨▓╨░╨╜╨╕╤Å ╨┤╨░╨╜╨╜╤ï╤à ╨╜╨░╨▒╨╗╤Ä╨┤╨░╨╡╨╝╨╛╨│╨╛ ╨╕╨│╤Ç╨╛╨║╨░
// ------------------------------
function getObserverData() {
  let observedData = null;

  // 1) Если API /player прислал текущего игрока
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

  // 2) Если нет, пробуем вычислить по observer_slot
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

  // 3) Заглушка
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
// WebSocket ╨┤╨╗╤Å ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╕╤Å ╨┤╨░╨╜╨╜╤ï╤à ╨╜╨░╨▒╨╗╤Ä╨┤╨░╤é╨╡╨╗╤Å ╨▓ ╤Ç╨╡╨░╨╗╤î╨╜╨╛╨╝ ╨▓╤Ç╨╡╨╝╨╡╨╜╨╕
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
  console.log('WebSocket-╤ü╨╛╨╡╨┤╨╕╨╜╨╡╨╜╨╕╨╡ ╤â╤ü╤é╨░╨╜╨╛╨▓╨╗╨╡╨╜╨╛');
  ws.send(JSON.stringify([getObserverData()]));
  
  // ╨ú╨▒╨╕╤Ç╨░╨╡╨╝ ╨╕╨╜╤é╨╡╤Ç╨▓╨░╨╗, ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╕╨╡ ╨▒╤â╨┤╨╡╤é ╨┐╨╛ GSI POST
  // const intervalId = setInterval(() => {
  //   if (ws.readyState === WebSocket.OPEN) {
  //     ws.send(JSON.stringify([getObserverData()]));
  //   }
  // }, 1000);
  
  ws.on('close', () => {
    // clearInterval(intervalId); // ╨í╨╛╨╛╤é╨▓╨╡╤é╤ü╤é╨▓╨╡╨╜╨╜╨╛, ╤ì╤é╨╛ ╤é╨╛╨╢╨╡ ╤â╨▒╨╕╤Ç╨░╨╡╨╝
    console.log('WebSocket-╤ü╨╛╨╡╨┤╨╕╨╜╨╡╨╜╨╕╨╡ ╨╖╨░╨║╤Ç╤ï╤é╨╛');
  });
});

// ------------------------------
// ╨ñ╤â╨╜╨║╤å╨╕╤Å ╨┤╨╗╤Å ╤ä╨╛╤Ç╨╝╨╕╤Ç╨╛╨▓╨░╨╜╨╕╤Å ╨╕╨╜╤ä╨╛╤Ç╨╝╨░╤å╨╕╨╕ ╨╛ ╤Ç╨░╤â╨╜╨┤╨╡
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
      
      // ╨ö╨╗╤Å ╨┐╨╡╤Ç╨▓╤ï╤à 12 ╤Ç╨░╤â╨╜╨┤╨╛╨▓ ╨╕╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╤î╨╜╨╛╨╡ ╤Ç╨░╤ü╨┐╤Ç╨╡╨┤╨╡╨╗╨╡╨╜╨╕╨╡
      if (roundNumber <= 12) { // ╨Æ╨░╤ê╨░ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╤î╨╜╨░╤Å ╨╗╨╛╨│╨╕╨║╨░
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
        // ╨ö╨╗╤Å ╤Ç╨░╤â╨╜╨┤╨╛╨▓ ╤ü 13-╨│╨╛ ╨╕╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ ╤é╨╡╨║╤â╤ë╨╕╨╡ ╨┤╨░╨╜╨╜╤ï╨╡
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
// ╨₧╨▒╤Ç╨░╨▒╨╛╤é╤ç╨╕╨║ ╨┤╨░╨╜╨╜╤ï╤à GSI ╨╛╤é CS:GO/CS2 (POST "/")
// ------------------------------
app.post('/', (req, res) => {
  const data = req.body;
  if (!data) {
    return res.status(400).json({ error: "╨¥╨╡╤é ╨┐╨╛╨╗╤â╤ç╨╡╨╜╨╜╤ï╤à ╨┤╨░╨╜╨╜╤ï╤à ╨▓ ╤ä╨╛╤Ç╨╝╨░╤é╨╡ JSON" });
  }
  
  if (data.map && data.map.round === 1) { // ╨æ╤ï╨╗╨╛ data.map.round === 1, ╨╛╤ü╤é╨░╨▓╨╗╤Å╨╡╨╝ ╨║╨░╨║ ╨╡╤ü╤é╤î
    const finalStats = computeFinalADR();
    console.log("╨£╨░╤é╤ç ╨╖╨░╨▓╨╡╤Ç╤ê╤æ╨╜. ╨ÿ╤é╨╛╨│╨╛╨▓╤ï╨╣ ADR:", finalStats);
    scoreboard.players = {};
    roundsHistory = [];
    roundsAlive = [];
    // Обновим ключ матча, если уже знаем имена команд
    currentMatchKey = buildMatchKey(data.map);
    // scoreboard.map = {}; // ╨¡╤é╨╛ ╨╝╨╛╨╢╨╡╤é ╨▒╤ï╤é╤î ╤ü╨╗╨╕╤ê╨║╨╛╨╝ ╤Ç╨░╨╜╨╛, ╨╡╤ü╨╗╨╕ ╨╡╤ë╨╡ ╨╜╤â╨╢╨╜╤ï original_team_ct/t
  }
  
  if (data.map) {
    if (!scoreboard.map.name || scoreboard.map.name !== data.map.name) {
      console.log("╨¥╨╛╨▓╨░╤Å ╨║╨░╤Ç╤é╨░:", data.map.name, "ΓÇö ╨▓╤ï╨┐╨╛╨╗╨╜╤Å╨╡╤é╤ü╤Å ╤ü╨▒╤Ç╨╛╤ü ╨┤╨░╨╜╨╜╤ï╤à");
      if (scoreboard.map.name) { // ╨ò╤ü╨╗╨╕ ╨┐╤Ç╨╡╨┤╤ï╨┤╤â╤ë╨░╤Å ╨║╨░╤Ç╤é╨░ ╨▒╤ï╨╗╨░
        const finalStats = computeFinalADR();
        console.log("╨ÿ╤é╨╛╨│╨╛╨▓╤ï╨╣ ADR ╨╖╨░╨▓╨╡╤Ç╤ê╤æ╨╜╨╜╨╛╨│╨╛ ╨╝╨░╤é╤ç╨░:", finalStats);
      }
      scoreboard.players = {}; // ╨í╨▒╤Ç╨░╤ü╤ï╨▓╨░╨╡╨╝ ╨╕╨│╤Ç╨╛╨║╨╛╨▓ ╨┐╤Ç╨╕ ╤ü╨╝╨╡╨╜╨╡ ╨║╨░╤Ç╤é╤ï
      roundsHistory = [];
      roundsAlive = [];
      // scoreboard.map = {}; // ╨í╨▒╤Ç╨░╤ü╤ï╨▓╨░╨╡╨╝ ╨║╨░╤Ç╤é╤â
      // ╨ƒ╤Ç╨╕ ╨╜╨╛╨▓╨╛╨╝ ╨╝╨░╤é╤ç╨╡ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╤î╨╜╨╛╨╡ ╤Ç╨░╤ü╨┐╤Ç╨╡╨┤╨╡╨╗╨╡╨╜╨╕╨╡ ╤ü╨╛╨▓╨┐╨░╨┤╨░╨╡╤é ╤ü ╤é╨╡╨║╤â╤ë╨╕╨╝
      scoreboard.map = { // ╨ú╤ü╤é╨░╨╜╨░╨▓╨╗╨╕╨▓╨░╨╡╨╝ ╨╜╨╛╨▓╤â╤Ä ╨║╨░╤Ç╤é╤â ╨╕ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╤î╨╜╤ï╨╡ ╨║╨╛╨╝╨░╨╜╨┤╤ï
        ...data.map,
        original_team_ct: data.map.team_ct ? {...data.map.team_ct} : null, // ╨Ü╨╛╨┐╨╕╤Ç╤â╨╡╨╝ ╨╛╨▒╤è╨╡╨║╤é╤ï
        original_team_t: data.map.team_t ? {...data.map.team_t} : null
      };
      currentMatchKey = buildMatchKey(data.map);
    } else {
      // Та же карта. Проверим смену матчапа (имена команд).
      const incomingMatchKey = buildMatchKey(data.map);
      if (incomingMatchKey && currentMatchKey && incomingMatchKey !== currentMatchKey) {
        console.log(`Матч изменился при той же карте: ${currentMatchKey} -> ${incomingMatchKey}. Сбрасываем историю раундов и игроков.`);
        const finalStats = computeFinalADR();
        console.log("Финальная ADR перед сбросом:", finalStats);
        scoreboard.players = {};
        roundsHistory = [];
        roundsAlive = [];
        // Перезапишем карту и зафиксируем новые оригинальные команды
        scoreboard.map = {
          ...data.map,
          original_team_ct: data.map.team_ct ? {...data.map.team_ct} : null,
          original_team_t: data.map.team_t ? {...data.map.team_t} : null
        };
        currentMatchKey = incomingMatchKey;
      } else {
        // Обычное обновление полей карты без потери original_team_ct/t
        scoreboard.map = {
          ...scoreboard.map,
          ...data.map
        };
        // При первом заходе зафиксируем ключ
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
      
      // ╨Æ╨░╤ê╨░ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╤î╨╜╨░╤Å ╨╗╨╛╨│╨╕╨║╨░ ADR:
      const roundDmgNow = newPlayerData?.state?.round_totaldmg || 0;
      const roundDmgPrev = scoreboard.players[steamId].previousRoundDmg || 0;
      if (roundDmgNow < roundDmgPrev) { // ╨í╨▒╤Ç╨╛╤ü, ╨╡╤ü╨╗╨╕ ╨╜╨╛╨▓╤ï╨╣ ╤â╤Ç╨╛╨╜ ╨╝╨╡╨╜╤î╤ê╨╡ ╨┐╤Ç╨╡╨┤╤ï╨┤╤â╤ë╨╡╨│╨╛ (╨╜╨░╤ç╨░╨╗╨╛ ╨╜╨╛╨▓╨╛╨│╨╛ ╤Ç╨░╤â╨╜╨┤╨░)
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
  
  if (data.player) { // ╨₧╨▒╤Ç╨░╨▒╨╛╤é╨║╨░ ╨┤╨░╨╜╨╜╤ï╤à ╨╜╨░╨▒╨╗╤Ä╨┤╨░╨╡╨╝╨╛╨│╨╛ ╨╕╨│╤Ç╨╛╨║╨░, ╨╡╤ü╨╗╨╕ ╨╛╨╜╨╕ ╨╜╨╡ ╨▓ allplayers
    scoreboard.player = data.player;
    const pSteam = data.player.steamid;
    if (pSteam && (!data.allplayers || !data.allplayers[pSteam])) {
      if (!scoreboard.players[pSteam]) {
        scoreboard.players[pSteam] = { accumulatedDmg: 0, previousRoundDmg: 0 };
      }
      scoreboard.players[pSteam] = { ...scoreboard.players[pSteam], ...data.player };
      // ╨Æ╨░╤ê╨░ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╤î╨╜╨░╤Å ╨╗╨╛╨│╨╕╨║╨░ ADR ╨┤╨╗╤Å data.player:
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
  
  console.log("╨ƒ╨╛╨╗╤â╤ç╨╡╨╜╤ï ╨┤╨░╨╜╨╜╤ï╨╡ GSI (╤ç╨░╤ü╤é╤î):", JSON.stringify(data, null, 2).substring(0, 300) + "...");

  if (scoreboard.map && scoreboard.map.round_wins) {
    // ╨₧╤ü╤é╨░╨▓╨╗╤Å╨╡╨╝ ╨▓╨░╤ê╤â ╨╗╨╛╨│╨╕╨║╤â ╨┤╨╗╤Å roundsHistory
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
    // ╨₧╤ü╤é╨░╨▓╨╗╤Å╨╡╨╝ ╨▓╨░╤ê╤â ╨╗╨╛╨│╨╕╨║╤â ╨┤╨╗╤Å roundsAlive
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
  res.status(200).json({ message: "╨ö╨░╨╜╨╜╤ï╨╡ ╨┐╨╛╨╗╤â╤ç╨╡╨╜╤ï" });
});

// ------------------------------
// ╨ƒ╤Ç╨╛╤ç╨╕╨╡ endpoints (REST API)
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
  const mapInfo = { CT: teamCT, T: teamT }; // ╨ÿ╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ ╨┐╨╛╨╗╨╜╤ï╨╡ ╨╛╨▒╤è╨╡╨║╤é╤ï
  const playersArr = [
    ...ctPlayers.map(p => ({ ...p, teamName: teamCT.name })), // ╨ö╨╛╨▒╨░╨▓╨╗╤Å╨╡╨╝ teamName
    ...tPlayers.map(p => ({ ...p, teamName: teamT.name }))  // ╨ö╨╛╨▒╨░╨▓╨╗╤Å╨╡╨╝ teamName
  ];

  res.json({ mapInfo, players: playersArr });
});


app.get('/teams', (req, res) => {
  const teamCTFromGSI = scoreboard.map?.team_ct || { name: "CT", score: 0, timeouts_remaining: 0 };
  const teamTFromGSI  = scoreboard.map?.team_t || { name: "T", score: 0, timeouts_remaining: 0 };

  const registeredTeamCT = teams.find(t => t.name.toLowerCase() === teamCTFromGSI.name.toLowerCase());
  const registeredTeamT  = teams.find(t => t.name.toLowerCase() === teamTFromGSI.name.toLowerCase());

  let mapName = scoreboard.map?.name?.replace(/^de_/, '') || "Unknown";
  
  // Функция для поиска файла карты независимо от регистра
  function findMapImage(mapName) {
    const mapDir = path.join(__dirname, 'public', 'map');
    try {
      const files = fs.readdirSync(mapDir);
      // Ищем файл, игнорируя регистр
      const foundFile = files.find(file => 
        file.toLowerCase() === `${mapName.toLowerCase()}.png`
      );
      return foundFile || `${mapName}.png`; // Возвращаем найденный файл или исходное имя
    } catch (error) {
      console.log('Error reading map directory:', error);
      return `${mapName}.png`; // Возвращаем исходное имя при ошибке
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
  const totalRounds = 24; // ╨Æ╨░╤ê╨╡ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╤î╨╜╨╛╨╡ ╨╖╨╜╨░╤ç╨╡╨╜╨╕╨╡
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
    let player = { ...scoreboard.players[steamId] }; // ╨ö╨░╨╜╨╜╤ï╨╡ ╨╕╨╖ GSI
    const regPlayer = players.find(p => p.steamId?.toLowerCase() === steamId.toLowerCase()); // ╨ö╨░╨╜╨╜╤ï╨╡ ╨╕╨╖ ╨▓╨░╤ê╨╡╨╣ ╨░╨┤╨╝╨╕╨╜╨║╨╕

    const name = regPlayer?.name || player.name; // ╨ƒ╤Ç╨╕╨╛╤Ç╨╕╤é╨╡╤é ╨╕╨╝╨╡╨╜╨╕ ╨╕╨╖ ╨░╨┤╨╝╨╕╨╜╨║╨╕
    const photoFromReg = regPlayer?.photo; // ╨ñ╨╛╤é╨╛ ╨╕╨╖ ╨░╨┤╨╝╨╕╨╜╨║╨╕

    const team = player.team;
    if (team === "CT" || team === "T") {
      const kills = player.match_stats?.kills || 0;
      const assists = player.match_stats?.assists || 0;
      const adrNum = parseFloat(getAverageDamage(steamId));
      
      const scoreValue = kills + assists + adrNum; // ╨Æ╨░╤ê╨░ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╤î╨╜╨░╤Å ╤ä╨╛╤Ç╨╝╤â╨╗╨░ MVP
      
      if (scoreValue > mvpScore && roundsPlayed > 0) { // MVP ╤é╨╛╨╗╤î╨║╨╛ ╨╡╤ü╨╗╨╕ ╨▒╤ï╨╗╨╕ ╤ü╤ï╨│╤Ç╨░╨╜╤ï ╤Ç╨░╤â╨╜╨┤╤ï
        mvpScore = scoreValue;
        const photoFull = photoFromReg ? `${baseUrl}${photoFromReg.startsWith('/') ? '' : '/'}${photoFromReg}` : defaultPlayerImage;
        
        let team_logo = defaultImage; // ╨ÿ╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ defaultImage ╨┐╨╛ ╤â╨╝╨╛╨╗╤ç╨░╨╜╨╕╤Ä
        let team_name = "";

        // ╨¢╨╛╨│╨╕╨║╨░ ╨╛╨┐╤Ç╨╡╨┤╨╡╨╗╨╡╨╜╨╕╤Å ╨╕╨╝╨╡╨╜╨╕ ╨║╨╛╨╝╨░╨╜╨┤╤ï ╨╕ ╨╗╨╛╨│╨╛╤é╨╕╨┐╨░ ╨╕╨╖ ╨▓╨░╤ê╨╡╨│╨╛ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╤î╨╜╨╛╨│╨╛ ╨║╨╛╨┤╨░
        if (regPlayer && regPlayer.teamId) {
          const teamObj = teams.find(t => t.id === regPlayer.teamId);
          if (teamObj) {
            team_logo = teamObj.logo ? `${baseUrl}${teamObj.logo}` : defaultImage;
            team_name = teamObj.name;
          }
        }
        if (!team_name) { // ╨ò╤ü╨╗╨╕ ╨┐╨╛ teamId ╨╜╨╡ ╨╜╨░╤ê╨╗╨╕ ╨╕╨╗╨╕ regPlayer ╨╜╨╡╤é
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
            team_name = actualTeamName; // ╨ò╤ü╨╗╨╕ ╨╕ ╨┐╨╛ ╨╕╨╝╨╡╨╜╨╕ ╨╜╨╡ ╨╜╨░╤ê╨╗╨╕, ╨▒╨╡╤Ç╨╡╨╝ "CT" ╨╕╨╗╨╕ "T"
          }
        }
        
        mvp = { 
          steamId, name, team, team_name, kills, assists, 
          deaths: player.match_stats?.deaths || 0, adr: adrNum, 
          mvpScore, // ╨▒╤ï╨╗╨╛ mvpScore: scoreValue, ╨╕╨╖╨╝╨╡╨╜╨╕╨╗ ╨╜╨░ mvpScore ╨┤╨╗╤Å ╨║╨╛╨╜╤ü╨╕╤ü╤é╨╡╨╜╤é╨╜╨╛╤ü╤é╨╕
          photo: photoFull, team_logo,
          // ╨Æ╨░╤ê╨░ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╤î╨╜╨░╤Å ╤ü╤é╨░╤é╨╕╤ü╤é╨╕╨║╨░
          kdRatio: parseFloat(player.match_stats?.deaths > 0 ? (kills / player.match_stats.deaths).toFixed(2) : kills.toFixed(2)),
          kpr: parseFloat(roundsPlayed > 0 ? (kills / roundsPlayed).toFixed(2) : "0.00"),
          kda: parseFloat(player.match_stats?.deaths > 0 ? ((kills + assists) / player.match_stats.deaths).toFixed(2) : (kills + assists).toFixed(2)),
          plusMinus: kills - (player.match_stats?.deaths || 0),
          totalDMG: player.accumulatedDmg || 0, // ╨ÿ╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ accumulatedDmg
          kast: player.match_stats?.kast ?? "N/A", // ╨ÿ╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ ?? ╨┤╨╗╤Å N/A
          dpr: parseFloat(adrNum.toFixed(2)), // ╨¡╤é╨╛ ╤é╨╛ ╨╢╨╡, ╤ç╤é╨╛ ╨╕ adr, ╨╜╨╛ ╤ü toFixed
          hsPercent: parseFloat(kills > 0 && player.match_stats?.headshots ? ((player.match_stats.headshots / kills) * 100).toFixed(2) : "0.00"),
          headshots: player.match_stats?.headshots || 0,
          accuracy: player.match_stats?.shots > 0 && player.match_stats?.hits ? ((player.match_stats.hits / player.match_stats.shots) * 100).toFixed(2) : "N/A"
        };
      }
    }
  }
  res.json(mvp ? [mvp] : []); // ╨Æ╨╛╨╖╨▓╤Ç╨░╤ë╨░╨╡╨╝ ╨╝╨░╤ü╤ü╨╕╨▓
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

// Тестовая страница админки
// Legacy route: redirect to main admin
app.get('/admin-test', (req, res) => res.redirect(302, '/admin'));

// Простая страница админки
// Legacy route: redirect to main admin
app.get('/admin-simple', (req, res) => res.redirect(302, '/admin'));

// Исправленная страница админки
// Legacy route: redirect to main admin
app.get('/admin-fixed', (req, res) => res.redirect(302, '/admin'));

// Страница со списком доступных карт (рендерит изображения из public/map)
app.get('/maps', (req, res) => {
  try {
    // Текущее имя карты без префикса de_
    let mapName = scoreboard.map?.name?.replace(/^de_/, '') || 'Unknown';

    // Поиск изображения карты без учета регистра, поддержка public/map и public/maps
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
      // Фолбэк: предполагаем public/map
      return { file: `${name}.png`, dirName: 'map' };
    }

    const { file: mapFileName, dirName: mapDirName } = findMapImage(mapName);
    const mapImagePath = `/${mapDirName}/${mapFileName}`; // относительный путь для статической раздачи
    const mapUrl = `${baseUrl}${mapImagePath}`;            // абсолютный URL

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
  // Совместимость и явные поля с путями к изображению карты
  currentMapImage: mapUrl,         // абсолютный URL (как раньше)
  mapImageFile: mapFileName,       // имя файла, напр. overpass.png
  mapImagePath,                    // относительный путь, напр. /map/overpass.png
  mapImageUrl: mapUrl,             // абсолютный URL, напр. http://.../map/overpass.png
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
// === ╨¥╨É╨º╨É╨¢╨₧ ╨í╨ò╨Ü╨ª╨ÿ╨ÿ API ╨ö╨¢╨» CRUD ===
// ==================================

// --- API ╨┤╨╗╤Å ╨║╨╛╨╝╨░╨╜╨┤ ---
app.get('/api/teams', (req, res) => res.json(teams));

// ╨ö╨₧╨æ╨É╨Æ╨¢╨ò╨¥╨¥╨½╨Ö ╨£╨É╨á╨¿╨á╨ú╨ó ╨ö╨¢╨» ╨ƒ╨₧╨¢╨ú╨º╨ò╨¥╨ÿ╨» ╨₧╨ö╨¥╨₧╨Ö ╨Ü╨₧╨£╨É╨¥╨ö╨½
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
  const { name, logo, score } = req.body; // ╨₧╤ü╤é╨░╨▓╨╕╨╗ score, ╨║╨░╨║ ╨▓ ╨▓╨░╤ê╨╡╨╝ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╨╡
  if (!name) return res.status(400).json({error: "Team name is required"});
  const newTeam = { id: Date.now().toString(), name, logo: logo || null, score: score || 0 }; // score || 0
  teams.push(newTeam);
  saveData();
  res.status(201).json(newTeam); // ╨í╤é╨░╤é╤â╤ü 201 ╨┤╨╗╤Å ╤ü╨╛╨╖╨┤╨░╨╜╨╕╤Å
});

app.put('/api/teams/:id', (req, res) => {
  const { id } = req.params;
  const { name, logo, score } = req.body; // ╨₧╤ü╤é╨░╨▓╨╕╨╗ score
  const teamIndex = teams.findIndex(t => t.id === id); // ╨ÿ╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ findIndex ╨┤╨╗╤Å ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╕╤Å
  if (teamIndex === -1) return res.status(404).json({ error: "Team not found" });
  
  teams[teamIndex].name = name !== undefined ? name : teams[teamIndex].name;
  teams[teamIndex].logo = logo !== undefined ? logo : teams[teamIndex].logo;
  teams[teamIndex].score = score !== undefined ? (score || 0) : teams[teamIndex].score; // score || 0
  saveData();
  res.json(teams[teamIndex]);
});

app.delete('/api/teams/:id', (req, res) => {
  const { id } = req.params;
  const originalLength = teams.length;
  teams = teams.filter(t => t.id !== id); // ╨ÿ╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ filter, ╨║╨░╨║ ╨▓ ╨▓╨░╤ê╨╡╨╝ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╨╡
  if (teams.length < originalLength) {
    players = players.map(p => p.teamId === id ? { ...p, teamId: null } : p);
    saveData();
    res.status(200).json({ message: "Team deleted" }); // ╨í╤é╨░╤é╤â╤ü 200
  } else {
    res.status(404).json({ error: "Team not found" });
  }
});

app.post('/api/teams/uploadLogo', uploadTeams.single('logoFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = '/logos/' + req.file.filename;
  res.json({ path: filePath });
});

// --- API ╨┤╨╗╤Å ╨╕╨│╤Ç╨╛╨║╨╛╨▓ ---
app.get('/api/players', (req, res) => res.json(players));

// ╨ö╨₧╨æ╨É╨Æ╨¢╨ò╨¥╨¥╨½╨Ö ╨£╨É╨á╨¿╨á╨ú╨ó ╨ö╨¢╨» ╨ƒ╨₧╨¢╨ú╨º╨ò╨¥╨ÿ╨» ╨₧╨ö╨¥╨₧╨ô╨₧ ╨ÿ╨ô╨á╨₧╨Ü╨É
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
  const { name, steamId, photo, teamId, match_stats } = req.body; // ╨₧╤ü╤é╨░╨▓╨╕╨╗ match_stats
  if (!name) return res.status(400).json({error: "Player name is required"});
  const newPlayer = { 
    id: Date.now().toString(), name, steamId: steamId || null, 
    photo: photo || null, teamId: teamId || null, 
    match_stats: match_stats || {} // ╨ÿ╨╜╨╕╤å╨╕╨░╨╗╨╕╨╖╨╕╤Ç╤â╨╡╨╝, ╨║╨░╨║ ╨▓ ╨▓╨░╤ê╨╡╨╝ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╨╡
  };
  players.push(newPlayer);
  saveData();
  res.status(201).json(newPlayer); // ╨í╤é╨░╤é╤â╤ü 201
});

app.put('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const { name, steamId, photo, teamId, match_stats } = req.body; // ╨₧╤ü╤é╨░╨▓╨╕╨╗ match_stats
  const playerIndex = players.findIndex(p => p.id === id); // ╨ÿ╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ findIndex
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
  players = players.filter(p => p.id !== id); // ╨ÿ╤ü╨┐╨╛╨╗╤î╨╖╤â╨╡╨╝ filter, ╨║╨░╨║ ╨▓ ╨▓╨░╤ê╨╡╨╝ ╨╛╤Ç╨╕╨│╨╕╨╜╨░╨╗╨╡
  if (players.length < originalLength) {
    saveData();
    res.status(200).json({ message: "Player deleted" }); // ╨í╤é╨░╤é╤â╤ü 200
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
// === ИМПОРТ ИЗ XLSX ФАЙЛОВ ===
// ================================

/**
 * Извлекает встроенные изображения из xlsx-буфера.
 * Возвращает объект { rowIndex: { data: Buffer, ext: string } },
 * где rowIndex — 0-based индекс строки в drawing (0 = заголовок, 1 = первая строка данных).
 */
function extractXlsxImageMap(buffer) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(buffer);
    const relsEntry = zip.getEntry('xl/drawings/_rels/drawing1.xml.rels');
    const drawingEntry = zip.getEntry('xl/drawings/drawing1.xml');
    if (!relsEntry || !drawingEntry) return {};

    // rId → имя файла в xl/media/
    const ridToFile = {};
    const relsXml = relsEntry.getData().toString('utf8');
    for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]+Target="[^"]*\/([^"/]+)"/g)) {
      ridToFile[m[1]] = m[2];
    }

    // строка drawing (0-based) → данные изображения
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

// POST /api/import/teams — импорт команд из xlsx
app.post('/api/import/teams', uploadXlsx.single('xlsxFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

    if (rows.length < 2) return res.status(400).json({ error: 'Файл пуст или не содержит данных' });

    const headers = rows[0].map(h => String(h || '').trim().toLowerCase());

    // Защита от случайной загрузки файла игроков в импорт команд
    if (headers.includes('username') || headers.includes('steamid')) {
      return res.status(400).json({ error: 'Похоже, вы загрузили файл игроков. Для импорта команд используйте файл с колонкой "Team name" без колонок Username/SteamID.' });
    }

    const teamNameIdx = headers.findIndex(h => h === 'team name');
    const logoIdx = headers.findIndex(h => ['logo', 'team logo', 'avatar'].includes(h));

    if (teamNameIdx === -1) return res.status(400).json({ error: 'Колонка "Team name" не найдена в файле' });

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

      // Определяем логотип: сначала из колонки, потом из встроенного изображения
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
      message: `Импорт завершён: создано ${created} команд, пропущено ${skipped} (уже существуют)`,
      created,
      skipped
    });
  } catch (err) {
    console.error('Ошибка при парсинге xlsx:', err);
    res.status(500).json({ error: 'Ошибка при разборе файла: ' + err.message });
  }
});

// POST /api/import/players — импорт игроков из xlsx
app.post('/api/import/players', uploadXlsx.single('xlsxFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

    if (rows.length < 2) return res.status(400).json({ error: 'Файл пуст или не содержит данных' });

    const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
    const usernameIdx = headers.findIndex(h => h === 'username');
    const steamIdIdx = headers.findIndex(h => h === 'steamid');
    const teamNameIdx = headers.findIndex(h => h === 'team name');
    const photoIdx = headers.findIndex(h => ['avatar', 'photo'].includes(h));

    if (usernameIdx === -1) return res.status(400).json({ error: 'Колонка "Username" не найдена в файле' });

    const imageMap = extractXlsxImageMap(req.file.buffer);
    const playersDir = path.join(__dirname, 'public', 'players');
    if (!fs.existsSync(playersDir)) fs.mkdirSync(playersDir, { recursive: true });

    let created = 0, skipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = row[usernameIdx] ? String(row[usernameIdx]).trim() : null;
      if (!name) continue;

      const steamId = (steamIdIdx !== -1 && row[steamIdIdx]) ? String(row[steamIdIdx]).trim() : null;

      // Проверяем существование по steamId (приоритет) или по нику
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

      // Ищем команду по имени
      let teamId = null;
      if (teamNameIdx !== -1 && row[teamNameIdx]) {
        const teamName = String(row[teamNameIdx]).trim();
        const teamObj = teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());
        if (teamObj) teamId = teamObj.id;
      }

      // Определяем фото: сначала из колонки, потом из встроенного изображения
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
      message: `Импорт завершён: создано ${created} игроков, пропущено ${skipped} (уже существуют)`,
      created,
      skipped
    });
  } catch (err) {
    console.error('Ошибка при парсинге xlsx:', err);
    res.status(500).json({ error: 'Ошибка при разборе файла: ' + err.message });
  }
});

// ================================
// === ╨Ü╨₧╨¥╨ò╨ª ╨í╨ò╨Ü╨ª╨ÿ╨ÿ API ╨ö╨¢╨» CRUD ===
// ================================


app.get('/alive', (req, res) => res.json(roundsAlive));

// ------------------------------
// ╨ù╨░╨┐╤â╤ü╨║ ╤ü╨╡╤Ç╨▓╨╡╤Ç╨░ (Express + WebSocket)
// ------------------------------
server.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on ${baseUrl} (HTTP and WebSocket on port ${port})`);
});
