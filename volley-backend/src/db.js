const { Pool } = require('pg');
require('dotenv').config(); // Certifique-se de que o arquivo .env esteja carregado corretamente

// Configuração da conexão com o banco de dados
const pool = new Pool({
  user: process.env.DB_USER,       // Nome do usuário do banco
  host: process.env.DB_HOST,       // Host do banco (geralmente localhost ou IP)
  database: process.env.DB_NAME,   // Nome do banco
  password: process.env.DB_PASS,   // Senha do banco
  port: process.env.DB_PORT,       // Porta do banco (geralmente 5432 para PostgreSQL)
});

// Middleware para log de conexões bem-sucedidas
pool.on('connect', () => {
  console.log('Conexão estabelecida com o banco de dados.');
});

// Middleware para log de erros de conexão
pool.on('error', (err) => {
  console.error('Erro na conexão com o banco de dados:', err);
});

// Função para logar e executar consultas SQL
const query = async (text, params) => {
  try {
    console.log(`Executando consulta SQL: ${text} | Parâmetros: ${JSON.stringify(params)}`);
    const result = await pool.query(text, params);
    console.log(`Resultado da consulta: ${JSON.stringify(result.rows)}`);
    return result;
  } catch (error) {
    console.error('Erro durante a execução da consulta:', error);
    throw error; // Repassa o erro para quem chamou a função
  }
};

// Função para obter um cliente do banco de dados para transações
const getClient = async () => {
  try {
    const client = await pool.connect();
    console.log('Cliente de transação conectado.');
    return client;
  } catch (error) {
    console.error('Erro ao obter cliente do banco de dados:', error);
    throw error;
  }
};

module.exports = {
  query,
  getClient, // Agora disponível para uso em transações
  pool,      // Exporta o pool para conexões diretas, se necessário
};
