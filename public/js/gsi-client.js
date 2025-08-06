// GSI (Game State Integration) клиент
class GSIClient {
  constructor() {
    this.gameState = null;
    this.listeners = {};
    this.isConnected = false;
    this.lastUpdate = null;
  }

  // Подписка на события GSI
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  // Обработка обновлений состояния игры
  handleGameStateUpdate(gameState) {
    const oldState = this.gameState;
    this.gameState = gameState;
    this.lastUpdate = new Date();
    this.isConnected = true;

    // Вызываем общий обработчик обновления
    this.emit('update', gameState);

    // Проверяем специфичные изменения
    if (oldState) {
      // Смена карты
      if (oldState.map?.name !== gameState.map?.name) {
        this.emit('map_change', gameState.map);
      }

      // Смена раунда
      if (oldState.round?.phase !== gameState.round?.phase) {
        this.emit('round_phase_change', gameState.round);
      }

      // Изменения бомбы
      if (oldState.bomb?.state !== gameState.bomb?.state) {
        this.emit('bomb_state_change', gameState.bomb);
      }

      // Изменения игрока
      if (gameState.player && oldState.player) {
        if (oldState.player.state?.health !== gameState.player.state?.health) {
          this.emit('player_health_change', {
            old: oldState.player.state?.health,
            new: gameState.player.state?.health
          });
        }

        if (oldState.player.state?.money !== gameState.player.state?.money) {
          this.emit('player_money_change', {
            old: oldState.player.state?.money,
            new: gameState.player.state?.money
          });
        }
      }
    }
  }

  // Вызов обработчиков событий
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }

  // HTTP методы для получения GSI данных
  async getGameState() {
    try {
      const response = await fetch('/gsi');
      const data = await response.json();
      return data.gameState;
    } catch (error) {
      console.error('Error fetching game state:', error);
      return null;
    }
  }

  async getGameSection(section) {
    try {
      const response = await fetch(`/gsi/${section}`);
      return await response.json();
    } catch (error) {
      console.error(`Error fetching ${section}:`, error);
      return null;
    }
  }

  async getGSIStatus() {
    try {
      const response = await fetch('/gsi/status');
      return await response.json();
    } catch (error) {
      console.error('Error fetching GSI status:', error);
      return null;
    }
  }

  // Утилиты для работы с данными GSI
  isInGame() {
    return this.gameState && this.gameState.map && this.gameState.player;
  }

  getCurrentMap() {
    return this.gameState?.map?.name || null;
  }

  getCurrentRound() {
    return this.gameState?.round || null;
  }

  getPlayerData() {
    return this.gameState?.player || null;
  }

  getTeamsData() {
    return this.gameState?.teams || null;
  }

  getAllPlayers() {
    return this.gameState?.allplayers || null;
  }

  getBombData() {
    return this.gameState?.bomb || null;
  }

  // Проверка активности GSI
  isGSIActive() {
    if (!this.lastUpdate) return false;
    const timeDiff = Date.now() - this.lastUpdate.getTime();
    return timeDiff < 10000; // активен если обновления были менее 10 сек назад
  }

  // Получение статистики игрока
  getPlayerStats() {
    const player = this.getPlayerData();
    if (!player || !player.match_stats) return null;

    return {
      kills: player.match_stats.kills || 0,
      assists: player.match_stats.assists || 0,
      deaths: player.match_stats.deaths || 0,
      mvps: player.match_stats.mvps || 0,
      score: player.match_stats.score || 0,
      money: player.state?.money || 0,
      health: player.state?.health || 0,
      armor: player.state?.armor || 0
    };
  }

  // Получение статистики команд
  getTeamsStats() {
    const teams = this.getTeamsData();
    if (!teams) return null;

    return {
      ct: {
        score: teams.CT?.score || 0,
        timeouts_remaining: teams.CT?.timeouts_remaining || 0,
        matches_won_this_series: teams.CT?.matches_won_this_series || 0
      },
      t: {
        score: teams.T?.score || 0,
        timeouts_remaining: teams.T?.timeouts_remaining || 0,
        matches_won_this_series: teams.T?.matches_won_this_series || 0
      }
    };
  }
}

// Создаем глобальный экземпляр GSI клиента
window.gsiClient = new GSIClient();

// Подключаем GSI клиент к WebSocket клиенту данных
if (window.dataClient) {
  dataClient.on('GAME_STATE_UPDATE', (gameState) => {
    gsiClient.handleGameStateUpdate(gameState);
  });
}

// Примеры использования GSI:

// Подписка на события игры
gsiClient.on('map_change', (map) => {
  console.log('Map changed to:', map.name);
  document.getElementById('current-map').textContent = map.name;
});

gsiClient.on('round_phase_change', (round) => {
  console.log('Round phase changed to:', round.phase);
  document.getElementById('round-phase').textContent = round.phase;
});

gsiClient.on('bomb_state_change', (bomb) => {
  console.log('Bomb state changed to:', bomb.state);
  // Обновить интерфейс в зависимости от состояния бомбы
});

gsiClient.on('player_health_change', (health) => {
  console.log('Player health:', health.old, '->', health.new);
  // Обновить полоску здоровья
});

// Периодическая проверка состояния GSI
setInterval(async () => {
  const status = await gsiClient.getGSIStatus();
  if (status) {
    const statusElement = document.getElementById('gsi-status');
    if (statusElement) {
      statusElement.textContent = status.isActive ? 'GSI Active' : 'GSI Inactive';
      statusElement.className = status.isActive ? 'status-active' : 'status-inactive';
    }
  }
}, 5000);
