const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = 2727;

// Создаем HTTP сервер
const server = http.createServer(app);

// Создаем WebSocket сервер
const wss = new WebSocket.Server({ server });

// WebSocket соединения
wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data);
      
      // Обработка команд от клиента
      switch (data.type) {
        case 'GET_TEAMS':
          ws.send(JSON.stringify({
            type: 'TEAMS_DATA',
            data: loadTeams()
          }));
          break;
        case 'GET_PLAYERS':
          ws.send(JSON.stringify({
            type: 'PLAYERS_DATA',
            data: loadPlayers()
          }));
          break;
        case 'GET_GAME_STATE':
          ws.send(JSON.stringify({
            type: 'GAME_STATE_DATA',
            data: gameState
          }));
          break;
        case 'SUBSCRIBE_GSI':
          // Помечаем этого клиента как подписанного на GSI обновления
          ws.gsiSubscriber = true;
          ws.send(JSON.stringify({
            type: 'GSI_SUBSCRIBED',
            message: 'Successfully subscribed to GSI updates'
          }));
          break;
        default:
          ws.send(JSON.stringify({
            type: 'ERROR',
            message: 'Unknown command'
          }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

// Функция для отправки обновлений всем подключенным клиентам
function broadcastUpdate(type, data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, data }));
    }
  });
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/logos/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Load teams data
function loadTeams() {
  try {
    const data = fs.readFileSync('data.json', 'utf8');
    const parsed = JSON.parse(data);
    return parsed.teams || [];
  } catch (error) {
    console.error('Error loading teams:', error);
    return [];
  }
}

// Load players data
function loadPlayers() {
  try {
    const data = fs.readFileSync('data.json', 'utf8');
    const parsed = JSON.parse(data);
    return parsed.players || [];
  } catch (error) {
    console.error('Error loading players:', error);
    return [];
  }
}

// Save teams data
function saveTeams(teams) {
  try {
    const data = { teams: teams };
    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving teams:', error);
    return false;
  }
}

// Routes
app.get('/admin', (req, res) => {
  const teams = loadTeams();
  const players = loadPlayers();
  res.render('admin', { teams, players });
});

app.get('/api/teams', (req, res) => {
  const teams = loadTeams();
  res.json(teams);
});

app.post('/api/teams', upload.single('logo'), (req, res) => {
  const teams = loadTeams();
  const newTeam = {
    id: Date.now(),
    name: req.body.name,
    logo: req.file ? `logos/${req.file.filename}` : null
  };
  teams.push(newTeam);
  if (saveTeams(teams)) {
    // Отправляем обновление всем подключенным клиентам
    broadcastUpdate('TEAM_CREATED', newTeam);
    res.json({ success: true, team: newTeam });
  } else {
    res.status(500).json({ success: false, error: 'Failed to save team' });
  }
});

app.delete('/api/teams/:id', (req, res) => {
  const teams = loadTeams();
  const teamIndex = teams.findIndex(team => team.id == req.params.id);
  if (teamIndex !== -1) {
    const deletedTeam = teams.splice(teamIndex, 1)[0];
    if (saveTeams(teams)) {
      // Delete logo file if exists
      if (deletedTeam.logo) {
        const logoPath = path.join(__dirname, 'public', deletedTeam.logo);
        if (fs.existsSync(logoPath)) {
          fs.unlinkSync(logoPath);
        }
      }
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save changes' });
    }
  } else {
    res.status(404).json({ success: false, error: 'Team not found' });
  }
});

app.put('/api/teams/:id', upload.single('logo'), (req, res) => {
  const teams = loadTeams();
  const teamIndex = teams.findIndex(team => team.id == req.params.id);
  if (teamIndex !== -1) {
    const oldLogo = teams[teamIndex].logo;
    teams[teamIndex].name = req.body.name;
    if (req.file) {
      teams[teamIndex].logo = `logos/${req.file.filename}`;
      // Delete old logo file
      if (oldLogo) {
        const oldLogoPath = path.join(__dirname, 'public', oldLogo);
        if (fs.existsSync(oldLogoPath)) {
          fs.unlinkSync(oldLogoPath);
        }
      }
    }
    if (saveTeams(teams)) {
      res.json({ success: true, team: teams[teamIndex] });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save changes' });
    }
  } else {
    res.status(404).json({ success: false, error: 'Team not found' });
  }
});

// API для игроков
app.get('/api/players', (req, res) => {
  const players = loadPlayers();
  res.json(players);
});

app.get('/api/players/:teamId', (req, res) => {
  const players = loadPlayers();
  const teamPlayers = players.filter(player => player.teamId === req.params.teamId);
  res.json(teamPlayers);
});

app.post('/api/players', upload.single('photo'), (req, res) => {
  const players = loadPlayers();
  const newPlayer = {
    id: Date.now().toString(),
    name: req.body.name,
    steamId: req.body.steamId || '',
    teamId: req.body.teamId,
    photo: req.file ? `players/${req.file.filename}` : null,
    createdAt: new Date().toISOString()
  };
  players.push(newPlayer);
  
  // Сохраняем в JSON
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  data.players = players;
  if (fs.writeFileSync('data.json', JSON.stringify(data, null, 2))) {
    res.json({ success: true, player: newPlayer });
  } else {
    res.status(500).json({ success: false, error: 'Failed to save player' });
  }
});

// API для получения статистики
app.get('/api/stats', (req, res) => {
  const teams = loadTeams();
  const players = loadPlayers();
  
  const stats = {
    totalTeams: teams.length,
    totalPlayers: players.length,
    teamsWithPlayers: teams.map(team => ({
      ...team,
      playerCount: players.filter(p => p.teamId === team.id).length
    }))
  };
  
  res.json(stats);
});

// GSI (Game State Integration) endpoints
let gameState = {
  map: null,
  round: null,
  player: null,
  teams: null,
  bomb: null,
  phase_countdowns: null,
  allplayers: null,
  timestamp: null
};

// POST endpoint для получения данных от CS:GO/CS2
app.post('/gsi', (req, res) => {
  try {
    console.log('GSI Data received:', JSON.stringify(req.body, null, 2));
    
    // Сохраняем текущее состояние игры
    gameState = {
      ...req.body,
      timestamp: new Date().toISOString()
    };
    
    // Отправляем обновления всем подключенным WebSocket клиентам
    broadcastUpdate('GAME_STATE_UPDATE', gameState);
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing GSI data:', error);
    res.status(500).send('Error');
  }
});

// GET endpoint для получения текущего состояния игры
app.get('/gsi', (req, res) => {
  res.json({
    success: true,
    gameState: gameState,
    lastUpdate: gameState.timestamp
  });
});

// GET endpoint для получения только определенных данных GSI
app.get('/gsi/:section', (req, res) => {
  const section = req.params.section;
  
  if (gameState[section] !== undefined) {
    res.json({
      success: true,
      section: section,
      data: gameState[section],
      timestamp: gameState.timestamp
    });
  } else {
    res.status(404).json({
      success: false,
      error: `Section '${section}' not found`,
      availableSections: Object.keys(gameState)
    });
  }
});

// Endpoint для проверки активности GSI
app.get('/gsi/status', (req, res) => {
  const lastUpdate = gameState.timestamp ? new Date(gameState.timestamp) : null;
  const now = new Date();
  const isActive = lastUpdate && (now - lastUpdate) < 10000; // активен если обновления были менее 10 сек назад
  
  res.json({
    isActive: isActive,
    lastUpdate: gameState.timestamp,
    timeSinceLastUpdate: lastUpdate ? now - lastUpdate : null,
    gameState: {
      hasMap: !!gameState.map,
      hasPlayer: !!gameState.player,
      hasRound: !!gameState.round,
      hasTeams: !!gameState.teams
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});

module.exports = app;
