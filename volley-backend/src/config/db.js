// src/config/db.js
// Configuração da conexão com o banco de dados e funções utilitárias

const { Pool } = require('pg');

// Configuração da conexão com o banco de dados PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER,        // Usuário do banco
  host: process.env.DB_HOST,        // Host (localhost ou Render)
  database: process.env.DB_NAME,    // Nome do banco
  password: process.env.DB_PASS,    // Senha
  port: process.env.DB_PORT,        // Porta (5432 normalmente)
});

// Log de conexões bem-sucedidas
pool.on('connect', () => {
  console.log('✅ Conexão estabelecida com o banco de dados.');
});

// Log de erros de conexão
pool.on('error', (err) => {
  console.error('❌ Erro na conexão com o banco de dados:', err);
});

// Função padrão para consultas SQL simples
const query = async (text, params) => {
  try {
    console.log(`📄 Executando SQL: ${text} | Parâmetros: ${JSON.stringify(params)}`);
    const result = await pool.query(text, params);
    return result;
  } catch (error) {
    console.error('⚠️ Erro na consulta:', error);
    throw error;
  }
};

// Função para obter um client para transações
const getClient = async () => {
  try {
    const client = await pool.connect();
    console.log('🔄 Cliente de transação conectado.');
    return client;
  } catch (error) {
    console.error('⚠️ Erro ao obter cliente:', error);
    throw error;
  }
};

module.exports = {
  query,
  getClient,
  pool,
};
