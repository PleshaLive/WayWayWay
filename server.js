const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const port = process.env.PORT || 2727;

// Middleware для парсинга JSON и URL-encoded данных
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Статические файлы (логотипы, фото и т.д.)
app.use(express.static(path.join(__dirname, 'public')));

// Путь к файлу для хранения данных (persistent storage)
const DATA_FILE = path.join(__dirname, 'data.json');

// Данные для админки – команды и игроки (persistent storage)
let teams = [];    // Объекты: { id, name, logo, score }
let players = [];  // Объекты: { id, name, steamId, photo, teamId, match_stats }

// Объект scoreboard для данных GSI (от CS:GO/CS2)
let scoreboard = {
  players: {},
  map: {},
  player: {}
};

// Глобальная переменная для хранения истории раундов
let roundsHistory = [];

// Глобальное хранилище для данных о выживших игроках по раундам
let roundsAlive = [];

// ------------------------------
// Функция загрузки данных из data.json
// ------------------------------
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const jsonData = JSON.parse(raw);
      teams = jsonData.teams || [];
      players = jsonData.players || [];
      console.log("Данные загружены из data.json");
    } catch (err) {
      console.error("Ошибка при чтении data.json:", err);
      teams = [];
      players = [];
    }
  } else {
    console.log("Файл data.json не найден, начинаем с пустых данных");
  }
}

// Функция сохранения данных в data.json
function saveData() {
  const jsonData = { teams, players };
  fs.writeFileSync(DATA_FILE, JSON.stringify(jsonData, null, 2), 'utf8');
  console.log("Данные сохранены в data.json");
}

// Загружаем данные при старте сервера
loadData();

// ------------------------------
// Настройка Multer для загрузки логотипов команд
// ------------------------------
const storageTeams = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/logos/');
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const uploadTeams = multer({ storage: storageTeams });

// ------------------------------
// Настройка Multer для загрузки фотографий игроков
// ------------------------------
const storagePlayers = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/players/');
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const uploadPlayers = multer({ storage: storagePlayers });

function fixUrl(url) {
  if ((url.startsWith("http:/") && !url.startsWith("http://")) ||
      (url.startsWith("https:/") && !url.startsWith("https://"))) {
    // Заменяем первую встреченную подстроку "http:/" или "https:/" на корректное "http://" или "https://"
    return url.replace(/^https?:\//, match => match + '/');
  }
  return url;
}


// ------------------------------
// Предопределённые пути для Side_logo и winType_logo
// ------------------------------
const baseUrl = process.env.BASE_URL || 'https://waywayway-production.up.railway.app';
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

// Дефолтные изображения для случаев, когда логотип не найден
const defaultSideLogo = `${baseUrl}/side_logos/none.png`;
const defaultWinTypeLogo = `${baseUrl}/winType_logos/None.png`;
const defaultImage = `${baseUrl}/None.png`; // для команд, если не найден логотип
const defaultPlayerImage = `${baseUrl}/NoneP.png`;
// ------------------------------
// 1) Обновлённая функция для определения кол-ва сыгранных раундов
// ------------------------------
function getRoundCount() {
  let roundsFromWins = scoreboard.map && scoreboard.map.round_wins ? Object.keys(scoreboard.map.round_wins).length : 0;
  let roundsFromMap = scoreboard.map && scoreboard.map.round ? scoreboard.map.round : 0;
  // Используем максимальное значение, чтобы корректно учитывать овертайм
  return Math.max(roundsFromWins, roundsFromMap);
}

// ------------------------------
// 2) Функция для подсчёта ADR (accumulatedDmg / количество_сыгранных_раундов)
// ------------------------------
function getAverageDamage(steamId) {
  const totalDamage = scoreboard.players[steamId]?.accumulatedDmg || 0;
  const roundsPlayed = getRoundCount();
  if (roundsPlayed > 0) {
    // Возвращаем значение как строку с одним знаком после запятой
    return (totalDamage / roundsPlayed).toFixed(1);
  }
  return "0.0";
}

// ------------------------------
// Функция вычисления итогового ADR для всех игроков
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
// Вспомогательная функция для получения логотипа команды по данным игрока
// ------------------------------
function getTeamLogo(playerData) {
  let teamLogo = null;
  // Сначала ищем игрока в базе для получения teamId
  const regPlayer = players.find(p => p.steamId?.toLowerCase() === playerData.steamid?.toLowerCase());
  if (regPlayer && regPlayer.teamId) {
    const teamObj = teams.find(t => t.id === regPlayer.teamId);
    if (teamObj && teamObj.logo) {
      teamLogo = `${baseUrl}${teamObj.logo}`;
    }
  }
  // Если не нашли по teamId, пытаемся найти команду по имени
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
// Функция для формирования данных наблюдаемого игрока
// ------------------------------
function getObserverData() {
  let observedData = null;
  
  if (scoreboard.player && scoreboard.player.steamid) {
    let playerData = { ...scoreboard.player };
    const regPlayer = players.find(p => p.steamId?.toLowerCase() === playerData.steamid?.toLowerCase());
    if (regPlayer) {
      if (regPlayer.name) playerData.name = regPlayer.name;
      if (!playerData.photo && regPlayer.photo) {
        playerData.photo = regPlayer.photo;
      }
    }
    const kills = playerData.match_stats ? playerData.match_stats.kills : 0;
    const deaths = playerData.match_stats ? playerData.match_stats.deaths : 0;
    const adr = getAverageDamage(playerData.steamid);
    // Вместо фото игрока подставляем логотип его команды
    const teamLogo = getTeamLogo(playerData);
    
    observedData = {
      steamId: playerData.steamid,
      name: playerData.name,
      kills,
      deaths,
      adr,
      team: playerData.team,
      photo: teamLogo,
      observer_slot: playerData.observer_slot
    };
  }
  
  if (!observedData) {
    let observerSlot = "0";
    for (const steamId in scoreboard.players) {
      const player = scoreboard.players[steamId];
      if (player.observer_slot !== undefined && String(player.observer_slot) === observerSlot) {
        let playerData = { ...player };
        const regPlayer = players.find(p => p.steamId?.toLowerCase() === steamId.toLowerCase());
        if (regPlayer) {
          if (regPlayer.name) playerData.name = regPlayer.name;
          if (!playerData.photo && regPlayer.photo) {
            playerData.photo = regPlayer.photo;
          }
        }
        const kills = playerData.match_stats ? playerData.match_stats.kills : 0;
        const deaths = playerData.match_stats ? playerData.match_stats.deaths : 0;
        const adr = getAverageDamage(steamId);
        const teamLogo = getTeamLogo(playerData);
      
        observedData = {
          steamId,
          name: playerData.name,
          kills,
          deaths,
          adr,
          team: playerData.team,
          photo: teamLogo,
          observer_slot: playerData.observer_slot
        };
        break;
      }
    }
  }
  
  if (!observedData) {
    observedData = {
      steamId: "",
      name: "",
      kills: 0,
      deaths: 0,
      adr: 0,
      team: "",
      photo: defaultImage,
      observer_slot: ""
    };
  }
  
  return observedData;
}

// ------------------------------
// WebSocket для обновления данных наблюдателя в реальном времени
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
  console.log('WebSocket-соединение установлено');
  ws.send(JSON.stringify([getObserverData()]));
  
  const intervalId = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify([getObserverData()]));
    }
  }, 1000);
  
  ws.on('close', () => {
    clearInterval(intervalId);
    console.log('WebSocket-соединение закрыто');
  });
});

// ------------------------------
// Функция для формирования информации о раунде
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
      
      // Для первых 12 раундов используем оригинальное распределение
      if (roundNumber <= 12) {
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
        // Для раундов с 13-го используем текущие данные
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
// Обработчик данных GSI от CS:GO/CS2 (POST "/")
// ------------------------------
app.post('/', (req, res) => {
  const data = req.body;
  if (!data) {
    return res.status(400).json({ error: "Нет полученных данных в формате JSON" });
  }
  
  // Если получаем данные о карте и round равен 1 – считаем, что предыдущий матч завершён.
  if (data.map && data.map.round === 1) {
    const finalStats = computeFinalADR();
    console.log("Матч завершён. Итоговый ADR:", finalStats);
    // Сброс данных для нового матча/карты
    scoreboard.players = {};
    roundsHistory = [];
    roundsAlive = [];
    scoreboard.map = {};
  }
  
  if (data.map) {
    // Если текущая карта отсутствует или её имя отличается от нового, считаем, что началась новая карта
    if (!scoreboard.map.name || scoreboard.map.name !== data.map.name) {
      console.log("Новая карта:", data.map.name, "— выполняется сброс данных");
      if (scoreboard.map.name) {
        const finalStats = computeFinalADR();
        console.log("Итоговый ADR завершённого матча:", finalStats);
      }
      scoreboard.players = {};
      roundsHistory = [];
      roundsAlive = [];
      scoreboard.map = {};
    }
    
    // При новом матче оригинальное распределение совпадает с текущим
    scoreboard.map = {
      ...data.map,
      original_team_ct: data.map.team_ct,
      original_team_t: data.map.team_t
    };
  }
  
  // Обновляем данные игроков
  if (data.allplayers) {
    for (const steamId in data.allplayers) {
      const newPlayerData = data.allplayers[steamId];
      if (!scoreboard.players[steamId]) {
        scoreboard.players[steamId] = {
          accumulatedDmg: 0,
          previousRoundDmg: 0
        };
      }
      scoreboard.players[steamId] = {
        ...scoreboard.players[steamId],
        ...newPlayerData
      };
      if (scoreboard.players[steamId].accumulatedDmg === undefined) {
        scoreboard.players[steamId].accumulatedDmg = 0;
      }
      if (scoreboard.players[steamId].previousRoundDmg === undefined) {
        scoreboard.players[steamId].previousRoundDmg = 0;
      }
      const roundDmgNow = newPlayerData?.state?.round_totaldmg || 0;
      const roundDmgPrev = scoreboard.players[steamId].previousRoundDmg;
      if (roundDmgNow < roundDmgPrev) {
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
  
  if (data.player) {
    scoreboard.player = data.player;
    const pSteam = data.player.steamid;
    if (pSteam && (!data.allplayers || !data.allplayers[pSteam])) {
      if (!scoreboard.players[pSteam]) {
        scoreboard.players[pSteam] = {
          accumulatedDmg: 0,
          previousRoundDmg: 0
        };
      }
      scoreboard.players[pSteam] = {
        ...scoreboard.players[pSteam],
        ...data.player
      };
      const roundDmgNow = data.player?.state?.round_totaldmg || 0;
      const roundDmgPrev = scoreboard.players[pSteam].previousRoundDmg;
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
  
  console.log("Получены данные GSI:", JSON.stringify(data, null, 2));

  // Сохраняем информацию о раундах в roundsHistory
  if (scoreboard.map && scoreboard.map.round_wins) {
    Object.keys(scoreboard.map.round_wins).forEach(roundKey => {
      const roundNumber = parseInt(roundKey, 10);
      if (!roundsHistory.find(r => r.roundNumber === roundNumber)) {
        const winString = scoreboard.map.round_wins[roundKey];
        const newRound = createRoundInfo(roundNumber, winString);
        roundsHistory.push(newRound);
      }
    });
  }
  
  // Сохраняем информацию о выживших игроках в roundsAlive
  if (scoreboard.map && scoreboard.map.round_wins) {
    Object.keys(scoreboard.map.round_wins).forEach(roundKey => {
      const roundNumber = parseInt(roundKey, 10);
      if (!roundsAlive.find(r => r.round === roundNumber)) {
        let aliveCT = 0;
        let aliveT = 0;
        for (const steamId in scoreboard.players) {
          const player = scoreboard.players[steamId];
          // Предполагаем, что player.team содержит "CT" или "T", а player.state.health > 0 означает, что игрок жив
          if (player.team === "CT" && player.state && player.state.health > 0) {
            aliveCT++;
          }
          if (player.team === "T" && player.state && player.state.health > 0) {
            aliveT++;
          }
        }
        roundsAlive.push({
          round: roundNumber,
          CT: aliveCT,
          T: aliveT,
          images: {
            CT: `alive/ct${aliveCT}.png`,
            T: `alive/t${aliveT}.png`
          }
        });
      }
    });
  }
  
  broadcastObserverUpdate();
  
  res.status(200).json({ message: "Данные получены" });
});

// ------------------------------
// Прочие endpoints (REST API) для получения данных, CRUD и т.д.
// ------------------------------
app.get('/gsi', (req, res) => {
  res.json(scoreboard);
});

app.get('/scoreboard', (req, res) => {
  res.json(scoreboard);
});

app.get('/score', (req, res) => {
  let ctPlayers = [];
  let tPlayers = [];

  for (const steamId in scoreboard.players) {
    let player = { ...scoreboard.players[steamId] };
    const regPlayer = players.find(p => p.steamId?.toLowerCase() === steamId.toLowerCase());
    if (regPlayer) {
      if (regPlayer.name) {
        player.name = regPlayer.name;
      }
      if (!player.photo && regPlayer.photo) {
        player.photo = regPlayer.photo;
      }
    }

    // Формирование корректного URL для фото
    let photoFull = defaultPlayerImage;
    if (player.photo) {
      if (player.photo.startsWith("http")) {
        // Если URL начинается с "http", применяем исправление
        photoFull = fixUrl(player.photo);
      } else {
        // Если это относительный путь - добавляем baseUrl с ведущим слэшем
        const normalizedPhoto = player.photo.startsWith('/') ? player.photo : '/' + player.photo;
        photoFull = `${baseUrl}${normalizedPhoto}`;
      }
    }

    const team = player.team;
    if (team === "CT" || team === "T") {
      const kills = player.match_stats ? player.match_stats.kills : 0;
      const assists = player.match_stats ? player.match_stats.assists : 0;
      const deaths = player.match_stats ? player.match_stats.deaths : 0;
      const adr = getAverageDamage(steamId);

      const playerData = {
        steamId,
        name: player.name,
        kills,
        assists,
        deaths,
        adr,
        team,
        photo: photoFull
      };

      if (team === "CT") {
        ctPlayers.push(playerData);
      } else {
        tPlayers.push(playerData);
      }
    }
  }

  ctPlayers.sort((a, b) => b.kills - a.kills);
  tPlayers.sort((a, b) => b.kills - a.kills);

  const teamCT = (scoreboard.map && scoreboard.map.team_ct)
    ? scoreboard.map.team_ct
    : { name: "CT", score: 0, timeouts_remaining: 0 };
  const teamT = (scoreboard.map && scoreboard.map.team_t)
    ? scoreboard.map.team_t
    : { name: "T", timeouts_remaining: 0, score: 0 };

  const mapInfo = {
    CT: {
      teamName: teamCT.name,
      score: teamCT.score,
      timeoutsRemaining: teamCT.timeouts_remaining
    },
    T: {
      teamName: teamT.name,
      score: teamT.score,
      timeoutsRemaining: teamT.timeouts_remaining
    }
  };

  const playersArr = [
    ...ctPlayers.map(p => ({ ...p, teamName: teamCT.name })),
    ...tPlayers.map(p => ({ ...p, teamName: teamT.name }))
  ];

  res.json({ mapInfo, players: playersArr });
});



app.get('/teams', (req, res) => {
  const teamCTFromGSI = (scoreboard.map && scoreboard.map.team_ct)
    ? scoreboard.map.team_ct
    : { name: "CT", score: 0, timeouts_remaining: 0 };
  const teamTFromGSI  = (scoreboard.map && scoreboard.map.team_t)
    ? scoreboard.map.team_t
    : { name: "T", timeouts_remaining: 0, score: 0 };

  const registeredTeamCT = teams.find(t => t.name.toLowerCase() === teamCTFromGSI.name.toLowerCase());
  const registeredTeamT  = teams.find(t => t.name.toLowerCase() === teamTFromGSI.name.toLowerCase());

  let mapName = (scoreboard.map && scoreboard.map.name) ? scoreboard.map.name : "Unknown";
  mapName = mapName.replace(/^de_/, '');

  const mapUrl = `${baseUrl}/map/${mapName}.png`;

  let teamsData = [
    { 
      team: "CT", 
      teamName: registeredTeamCT ? registeredTeamCT.name : teamCTFromGSI.name, 
      score: teamCTFromGSI.score, 
      timeoutsRemaining: teamCTFromGSI.timeouts_remaining,
      logo: (registeredTeamCT && registeredTeamCT.logo) ? `${baseUrl}${registeredTeamCT.logo}` : null,
      mapName: mapName
    },
    { 
      team: "T",  
      teamName: registeredTeamT ? registeredTeamT.name : teamTFromGSI.name, 
      score: teamTFromGSI.score,
      timeoutsRemaining: teamTFromGSI.timeouts_remaining,
      logo: (registeredTeamT && registeredTeamT.logo) ? `${baseUrl}${registeredTeamT.logo}` : null,
      mapName: mapName
    }
  ];

  teamsData.push({ map: mapUrl });

  res.json({ teams: teamsData });
});

app.get('/rounds', (req, res) => {
  const totalRounds = 24;
  let roundsData = [];
  for (let i = 1; i <= totalRounds; i++) {
    let roundInfo = roundsHistory.find(r => r.roundNumber === i);
    if (!roundInfo) {
      roundInfo = {
        roundNumber: i,
        Team: "",
        Side: "",
        winType: "",
        team_logo: defaultImage,
        Side_logo: defaultSideLogo,
        winType_logo: defaultWinTypeLogo
      };
    }
    roundsData.push(roundInfo);
  }
  
  const mapName = (scoreboard.map && scoreboard.map.name) ? scoreboard.map.name : "Unknown";
  
  res.json({
    mapName: mapName,
    rounds: roundsData
  });
});

app.get('/mvp', (req, res) => {
  let mvp = null;
  let mvpScore = -1;
  
  const roundsPlayed = getRoundCount();

  for (const steamId in scoreboard.players) {
    let player = { ...scoreboard.players[steamId] };
    const regPlayer = players.find(p => p.steamId?.toLowerCase() === steamId.toLowerCase());
    if (regPlayer) {
      if (regPlayer.name) {
        player.name = regPlayer.name;
      }
      if (!player.photo && regPlayer.photo) {
        player.photo = regPlayer.photo;
      }
    }
    
    const team = player.team;
    if (team === "CT" || team === "T") {
      const kills = player.match_stats ? player.match_stats.kills : 0;
      const assists = player.match_stats ? player.match_stats.assists : 0;
      const deaths = player.match_stats ? player.match_stats.deaths : 0;
      const adrNum = parseFloat(getAverageDamage(steamId));
      
      const kdRatio = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
      const kpr = roundsPlayed > 0 ? (kills / roundsPlayed).toFixed(2) : "0.00";
      const kda = deaths > 0 ? ((kills + assists) / deaths).toFixed(2) : (kills + assists).toFixed(2);
      const plusMinus = kills - deaths;
      const totalDMG = scoreboard.players[steamId].accumulatedDmg;
      const kast = player.match_stats && player.match_stats.kast !== undefined ? player.match_stats.kast : "N/A";
      const dpr = adrNum.toFixed(2);

      const headshots = player.match_stats && player.match_stats.headshots ? player.match_stats.headshots : 0;
      const hsPercent = kills > 0 ? ((headshots / kills) * 100).toFixed(2) : "0.00";
      
      const shotsFired = player.match_stats && player.match_stats.shots ? player.match_stats.shots : 0;
      const hits = player.match_stats && player.match_stats.hits ? player.match_stats.hits : 0;
      const accuracy = shotsFired > 0 ? ((hits / shotsFired) * 100).toFixed(2) : "N/A";
      
      const scoreValue = kills + assists + adrNum; 
      
      if (scoreValue > mvpScore) {
        mvpScore = scoreValue;
        const photoFull = player.photo ? `${baseUrl}${player.photo}` : defaultPlayerImage;
        
        let team_logo = null;
        let team_name = "";
        if (regPlayer && regPlayer.teamId) {
          const teamObj = teams.find(t => t.id === regPlayer.teamId);
          if (teamObj) {
            team_logo = teamObj.logo ? `${baseUrl}${teamObj.logo}` : null;
            team_name = teamObj.name;
          }
        }
        if (!team_logo || !team_name) {
          let actualTeamName = team;
          if (team === "CT" && scoreboard.map.team_ct && scoreboard.map.team_ct.name) {
            actualTeamName = scoreboard.map.team_ct.name;
          } else if (team === "T" && scoreboard.map.team_t && scoreboard.map.team_t.name) {
            actualTeamName = scoreboard.map.team_t.name;
          }
          const regTeam = teams.find(t => t.name.toLowerCase() === actualTeamName.toLowerCase());
          if (regTeam) {
            team_logo = regTeam.logo ? `${baseUrl}${regTeam.logo}` : null;
            team_name = regTeam.name;
          } else {
            team_name = actualTeamName;
          }
        }
        team_logo = team_logo || defaultImage;
        
        mvp = { 
          steamId, 
          name: player.name, 
          team: team, 
          team_name: team_name, 
          kills, 
          assists,
          deaths,    
          adr: adrNum, 
          mvpScore: scoreValue, 
          photo: photoFull,
          team_logo: team_logo,
          kdRatio: parseFloat(kdRatio),
          kpr: parseFloat(kpr),
          kda: parseFloat(kda),
          plusMinus: plusMinus,
          totalDMG: totalDMG,
          kast: kast,
          dpr: parseFloat(dpr),
          hsPercent: parseFloat(hsPercent),
          headshots: headshots,
          accuracy: accuracy
        };
      }
    }
  }
  
  res.json(mvp ? [mvp] : []);
});


// ------------------------------
// Endpoint /observer – возвращает данные наблюдаемого игрока с логотипом команды вместо фото игрока
// ------------------------------
app.get('/observer', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  // Используем обновленную функцию getObserverData, которая возвращает логотип команды
  const observedData = getObserverData();
  res.json([observedData]);
});

app.get('/admin', (req, res) => {
  res.render('admin', { teams, players });
});

app.get('/api/teams', (req, res) => {
  res.json(teams);
});

app.post('/api/teams', (req, res) => {
  const { name, logo, score } = req.body;
  const newTeam = {
    id: Date.now().toString(),
    name,
    logo,
    score: score || 0
  };
  teams.push(newTeam);
  saveData();
  res.json(newTeam);
});

app.put('/api/teams/:id', (req, res) => {
  const { id } = req.params;
  const { name, logo, score } = req.body;
  const team = teams.find(t => t.id === id);
  if (!team) return res.status(404).json({ error: "Team not found" });
  team.name = name;
  team.logo = logo;
  team.score = score || 0;
  saveData();
  res.json(team);
});

app.delete('/api/teams/:id', (req, res) => {
  const { id } = req.params;
  const originalLength = teams.length;
  teams = teams.filter(t => t.id !== id);
  if (teams.length < originalLength) {
    players = players.map(p => p.teamId === id ? { ...p, teamId: null } : p);
    saveData();
    res.json({ message: "Team deleted" });
  } else {
    res.status(404).json({ error: "Team not found" });
  }
});

app.post('/api/teams/uploadLogo', uploadTeams.single('logoFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = '/logos/' + req.file.filename;
  res.json({ path: filePath });
});

app.get('/api/players', (req, res) => {
  res.json(players);
});

app.post('/api/players', (req, res) => {
  const { name, steamId, photo, teamId, match_stats } = req.body;
  const newPlayer = { 
    id: Date.now().toString(),
    name,
    steamId,
    photo,
    teamId: teamId || null,
    match_stats: match_stats || {}
  };
  players.push(newPlayer);
  saveData();
  res.json(newPlayer);
});

app.put('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const { name, steamId, photo, teamId, match_stats } = req.body;
  const player = players.find(p => p.id === id);
  if (!player) return res.status(404).json({ error: "Player not found" });
  player.name = name;
  player.steamId = steamId;
  player.photo = photo;
  player.teamId = teamId || null;
  player.match_stats = match_stats || {};
  saveData();
  res.json(player);
});

app.delete('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const originalLength = players.length;
  players = players.filter(p => p.id !== id);
  if (players.length < originalLength) {
    saveData();
    res.json({ message: "Player deleted" });
  } else {
    res.status(404).json({ error: "Player not found" });
  }
});

app.post('/api/players/uploadPhoto', uploadPlayers.single('photoFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = '/players/' + req.file.filename;
  res.json({ path: filePath });
});

// Новый endpoint /alive для данных о выживших игроках по раундам
app.get('/alive', (req, res) => {
  res.json(roundsAlive);
});

// ------------------------------
// Запуск сервера (Express + WebSocket)
// ------------------------------
server.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on ${baseUrl}`);
});
