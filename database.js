const { Pool } = require('pg');

// Настройки подключения к PostgreSQL
let pool;
let isConnected = false;

// Инициализация подключения к базе данных
async function initializeDatabase() {
  try {
    // Используем DATABASE_URL из переменных окружения Railway
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
      console.log('DATABASE_URL not found, database will not be initialized');
      return false;
    }

    pool = new Pool({
      connectionString: connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Тестируем подключение
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database');
    client.release();
    
    isConnected = true;
    await createTables();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    isConnected = false;
    return false;
  }
}

// Создание таблиц если они не существуют
async function createTables() {
  try {
    const client = await pool.connect();
    
    // Создаем таблицу команд
    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        logo TEXT,
        score INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создаем таблицу игроков
    await client.query(`
      CREATE TABLE IF NOT EXISTS players (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        steam_id VARCHAR(255),
        photo TEXT,
        team_id VARCHAR(255),
        team VARCHAR(255),
        match_stats JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
      )
    `);

    console.log('✅ Database tables created/verified');
    client.release();
  } catch (error) {
    console.error('❌ Error creating tables:', error);
  }
}

// Функции для работы с командами
async function getAllTeams() {
  try {
    if (!isConnected) return [];
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM teams ORDER BY name');
    client.release();
    return result.rows;
  } catch (error) {
    console.error('Error getting teams:', error);
    return [];
  }
}

async function createTeam(teamData) {
  try {
    if (!isConnected) return false;
    const client = await pool.connect();
    const { id, name, logo, score } = teamData;
    await client.query(
      'INSERT INTO teams (id, name, logo, score) VALUES ($1, $2, $3, $4)',
      [id, name, logo, score || 0]
    );
    client.release();
    return true;
  } catch (error) {
    console.error('Error creating team:', error);
    return false;
  }
}

async function updateTeam(id, updates) {
  try {
    if (!isConnected) return false;
    const client = await pool.connect();
    
    const fields = [];
    const values = [];
    let paramCount = 1;
    
    if (updates.name !== undefined) {
      fields.push(`name = $${paramCount++}`);
      values.push(updates.name);
    }
    if (updates.logo !== undefined) {
      fields.push(`logo = $${paramCount++}`);
      values.push(updates.logo);
    }
    if (updates.score !== undefined) {
      fields.push(`score = $${paramCount++}`);
      values.push(updates.score);
    }
    
    if (fields.length === 0) return false;
    
    values.push(id);
    const query = `UPDATE teams SET ${fields.join(', ')} WHERE id = $${paramCount}`;
    
    const result = await client.query(query, values);
    client.release();
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error updating team:', error);
    return false;
  }
}

async function deleteTeam(id) {
  try {
    if (!isConnected) return false;
    const client = await pool.connect();
    
    // Сначала обновляем игроков, убирая ссылку на команду
    await client.query('UPDATE players SET team_id = NULL, team = NULL WHERE team_id = $1', [id]);
    
    // Затем удаляем команду
    const result = await client.query('DELETE FROM teams WHERE id = $1', [id]);
    client.release();
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error deleting team:', error);
    return false;
  }
}

async function getTeamById(id) {
  try {
    if (!isConnected) return null;
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM teams WHERE id = $1', [id]);
    client.release();
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting team by id:', error);
    return null;
  }
}

// Функции для работы с игроками
async function getAllPlayers() {
  try {
    if (!isConnected) return [];
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM players ORDER BY name');
    client.release();
    return result.rows;
  } catch (error) {
    console.error('Error getting players:', error);
    return [];
  }
}

async function createPlayer(playerData) {
  try {
    if (!isConnected) return false;
    const client = await pool.connect();
    const { id, name, steamId, photo, teamId, team, matchStats } = playerData;
    await client.query(
      'INSERT INTO players (id, name, steam_id, photo, team_id, team, match_stats) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, name, steamId, photo, teamId, team, matchStats ? JSON.stringify(matchStats) : null]
    );
    client.release();
    return true;
  } catch (error) {
    console.error('Error creating player:', error);
    return false;
  }
}

async function updatePlayer(id, updates) {
  try {
    if (!isConnected) return false;
    const client = await pool.connect();
    
    const fields = [];
    const values = [];
    let paramCount = 1;
    
    if (updates.name !== undefined) {
      fields.push(`name = $${paramCount++}`);
      values.push(updates.name);
    }
    if (updates.steamId !== undefined) {
      fields.push(`steam_id = $${paramCount++}`);
      values.push(updates.steamId);
    }
    if (updates.photo !== undefined) {
      fields.push(`photo = $${paramCount++}`);
      values.push(updates.photo);
    }
    if (updates.teamId !== undefined) {
      fields.push(`team_id = $${paramCount++}`);
      values.push(updates.teamId);
    }
    if (updates.team !== undefined) {
      fields.push(`team = $${paramCount++}`);
      values.push(updates.team);
    }
    if (updates.matchStats !== undefined) {
      fields.push(`match_stats = $${paramCount++}`);
      values.push(updates.matchStats ? JSON.stringify(updates.matchStats) : null);
    }
    
    if (fields.length === 0) return false;
    
    values.push(id);
    const query = `UPDATE players SET ${fields.join(', ')} WHERE id = $${paramCount}`;
    
    const result = await client.query(query, values);
    client.release();
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error updating player:', error);
    return false;
  }
}

async function deletePlayer(id) {
  try {
    if (!isConnected) return false;
    const client = await pool.connect();
    const result = await client.query('DELETE FROM players WHERE id = $1', [id]);
    client.release();
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error deleting player:', error);
    return false;
  }
}

async function getPlayerById(id) {
  try {
    if (!isConnected) return null;
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM players WHERE id = $1', [id]);
    client.release();
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting player by id:', error);
    return null;
  }
}

// Закрытие подключения к базе данных
async function closeDatabase() {
  if (pool) {
    await pool.end();
    console.log('Database connection closed');
  }
}

// Проверка статуса подключения
function isDbConnected() {
  return isConnected;
}

module.exports = {
  initializeDatabase,
  closeDatabase,
  isDbConnected,
  
  // Teams
  getAllTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamById,
  
  // Players
  getAllPlayers,
  createPlayer,
  updatePlayer,
  deletePlayer,
  getPlayerById
};
