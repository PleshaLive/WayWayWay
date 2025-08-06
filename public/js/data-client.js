// Клиент для работы с API и WebSocket
class DataClient {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.connectWebSocket();
  }

  // Подключение к WebSocket
  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket disconnected. Reconnecting...');
      setTimeout(() => this.connectWebSocket(), 3000);
    };
  }

  // Обработка сообщений от сервера
  handleMessage(data) {
    if (this.listeners[data.type]) {
      this.listeners[data.type].forEach(callback => callback(data.data));
    }
  }

  // Подписка на события
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  // HTTP API методы
  async getTeams() {
    const response = await fetch('/api/teams');
    return response.json();
  }

  async getPlayers() {
    const response = await fetch('/api/players');
    return response.json();
  }

  async getPlayersByTeam(teamId) {
    const response = await fetch(`/api/players/${teamId}`);
    return response.json();
  }

  async createTeam(name, logoFile) {
    const formData = new FormData();
    formData.append('name', name);
    if (logoFile) {
      formData.append('logo', logoFile);
    }

    const response = await fetch('/api/teams', {
      method: 'POST',
      body: formData
    });
    return response.json();
  }

  async createPlayer(playerData, photoFile) {
    const formData = new FormData();
    formData.append('name', playerData.name);
    formData.append('steamId', playerData.steamId || '');
    formData.append('teamId', playerData.teamId);
    if (photoFile) {
      formData.append('photo', photoFile);
    }

    const response = await fetch('/api/players', {
      method: 'POST',
      body: formData
    });
    return response.json();
  }

  async getStats() {
    const response = await fetch('/api/stats');
    return response.json();
  }

  // WebSocket методы
  requestTeams() {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'GET_TEAMS' }));
    }
  }

  requestPlayers() {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'GET_PLAYERS' }));
    }
  }
}

// Создаем глобальный экземпляр клиента
window.dataClient = new DataClient();

// Примеры использования:

// Получение данных через HTTP API
async function loadData() {
  try {
    const teams = await dataClient.getTeams();
    const players = await dataClient.getPlayers();
    const stats = await dataClient.getStats();
    
    console.log('Teams:', teams);
    console.log('Players:', players);
    console.log('Stats:', stats);
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// Подписка на обновления в реальном времени
dataClient.on('TEAM_CREATED', (team) => {
  console.log('New team created:', team);
  // Обновить интерфейс
});

dataClient.on('TEAMS_DATA', (teams) => {
  console.log('Teams data received:', teams);
  // Обновить список команд в интерфейсе
});

// Создание новой команды
async function createNewTeam() {
  const logoFile = document.getElementById('logoInput').files[0];
  const result = await dataClient.createTeam('Новая команда', logoFile);
  console.log('Team created:', result);
}

// Запрос данных через WebSocket
function requestLiveData() {
  dataClient.requestTeams();
  dataClient.requestPlayers();
}
