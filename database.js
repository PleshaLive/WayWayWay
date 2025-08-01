const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Конфигурация базы данных
let pool;
let dbConnected = false;

try {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    dbConnected = true;
    console.log('Database connection configured');
  } else {
    console.log('No DATABASE_URL found, will use JSON fallback');
  }
} catch (error) {
  console.error('Database configuration error:', error);
  dbConnected = false;
}

// Инициализация таблиц
async function initDatabase() {
  if (!dbConnected || !pool) {
    console.log('Database not connected, skipping initialization');
    return false;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        logo TEXT,
        score INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        steam_id VARCHAR(255),
        photo TEXT,
        team_id VARCHAR(255),
        match_stats JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
      )
    `);

    console.log('Database tables initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing database:', error);
    dbConnected = false;
    return false;
  }
}

// Функции для команд
async function getAllTeams() {
  try {
    const result = await pool.query('SELECT * FROM teams ORDER BY created_at DESC');
    return result.rows;
  } catch (error) {
    console.error('Error getting teams:', error);
    return [];
  }
}

async function getTeamById(id) {
  try {
    const result = await pool.query('SELECT * FROM teams WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting team by id:', error);
    return null;
  }
}

async function createTeam(team) {
  try {
    const { id, name, logo } = team;
    await pool.query(
      'INSERT INTO teams (id, name, logo) VALUES ($1, $2, $3)',
      [id, name, logo]
    );
    return true;
  } catch (error) {
    console.error('Error creating team:', error);
    return false;
  }
}

async function updateTeam(id, updates) {
  try {
    const { name, logo } = updates;
    await pool.query(
      'UPDATE teams SET name = $2, logo = $3 WHERE id = $1',
      [id, name, logo]
    );
    return true;
  } catch (error) {
    console.error('Error updating team:', error);
    return false;
  }
}

async function deleteTeam(id) {
  try {
    // Сначала отвязываем игроков от команды
    await pool.query('UPDATE players SET team_id = NULL WHERE team_id = $1', [id]);
    // Затем удаляем команду
    await pool.query('DELETE FROM teams WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error('Error deleting team:', error);
    return false;
  }
}

// Функции для игроков
async function getAllPlayers() {
  try {
    const result = await pool.query('SELECT * FROM players ORDER BY created_at DESC');
    return result.rows.map(player => ({
      ...player,
      steamId: player.steam_id,
      teamId: player.team_id,
      match_stats: player.match_stats
    }));
  } catch (error) {
    console.error('Error getting players:', error);
    return [];
  }
}

async function getPlayerById(id) {
  try {
    const result = await pool.query('SELECT * FROM players WHERE id = $1', [id]);
    if (result.rows[0]) {
      const player = result.rows[0];
      return {
        ...player,
        steamId: player.steam_id,
        teamId: player.team_id,
        match_stats: player.match_stats
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting player by id:', error);
    return null;
  }
}

async function createPlayer(player) {
  try {
    const { id, name, steamId, photo, teamId } = player;
    await pool.query(
      'INSERT INTO players (id, name, steam_id, photo, team_id) VALUES ($1, $2, $3, $4, $5)',
      [id, name, steamId, photo, teamId]
    );
    return true;
  } catch (error) {
    console.error('Error creating player:', error);
    return false;
  }
}

async function updatePlayer(id, updates) {
  try {
    const { name, steamId, photo, teamId } = updates;
    await pool.query(
      'UPDATE players SET name = $2, steam_id = $3, photo = $4, team_id = $5 WHERE id = $1',
      [id, name, steamId, photo, teamId]
    );
    return true;
  } catch (error) {
    console.error('Error updating player:', error);
    return false;
  }
}

async function deletePlayer(id) {
  try {
    await pool.query('DELETE FROM players WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error('Error deleting player:', error);
    return false;
  }
}

// Миграция данных из JSON файла (для первичной настройки)
async function migrateFromJSON() {
  const jsonFile = path.join(__dirname, 'data.json');
  
  if (!fs.existsSync(jsonFile)) {
    console.log('JSON file not found, skipping migration');
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    
    // Миграция команд
    if (data.teams && data.teams.length > 0) {
      for (const team of data.teams) {
        const existingTeam = await getTeamById(team.id);
        if (!existingTeam) {
          await createTeam(team);
          console.log(`Migrated team: ${team.name}`);
        }
      }
    }

    // Миграция игроков
    if (data.players && data.players.length > 0) {
      for (const player of data.players) {
        const existingPlayer = await getPlayerById(player.id);
        if (!existingPlayer) {
          await createPlayer(player);
          console.log(`Migrated player: ${player.name}`);
        }
      }
    }

    console.log('Migration from JSON completed');
  } catch (error) {
    console.error('Error during migration:', error);
  }
}

module.exports = {
  initDatabase,
  migrateFromJSON,
  isConnected: () => dbConnected,
  // Teams
  getAllTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  // Players
  getAllPlayers,
  getPlayerById,
  createPlayer,
  updatePlayer,
  deletePlayer
};
