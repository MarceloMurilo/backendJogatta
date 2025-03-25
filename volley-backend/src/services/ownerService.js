// src/services/ownerService.js
const db = require('../config/db'); // Configuração do banco de dados
const bcrypt = require('bcryptjs'); // Para hash de senhas

// Busca informações da empresa pelo ID
async function getOwnerById(ownerId) {
  const result = await db.query('SELECT * FROM empresas WHERE id_empresa = $1', [ownerId]);
  return result.rows[0];
}

// Busca o stripe_account_id da empresa (dono da quadra)
async function getOwnerStripeAccountId(ownerId) {
  const result = await db.query('SELECT stripe_account_id FROM empresas WHERE id_empresa = $1', [ownerId]);
  return result.rows[0]?.stripe_account_id || null;
}

// Atualiza o stripe_account_id da empresa
async function updateOwnerStripeAccountId(ownerId, accountId) {
  await db.query('UPDATE empresas SET stripe_account_id = $1 WHERE id_empresa = $2', [accountId, ownerId]);
}
 // teste dantas
/**
 * Cria uma nova empresa com senha, CNPJ etc. (status inicial = 'pendente')
 * @param {*} param0 Objeto com { nome, endereco, contato, email_empresa, cnpj, senha, documento_url }
 */
async function createEmpresa({ nome, endereco, contato, email_empresa, cnpj, senha, documento_url }) {
  const hashedSenha = await bcrypt.hash(senha, 10); // Gera hash seguro da senha
  const result = await db.query(
    `INSERT INTO empresas 
       (nome, endereco, contato, email_empresa, cnpj, senha, documento_url, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente')
     RETURNING *`,
    [nome, endereco, contato, email_empresa, cnpj, hashedSenha, documento_url]
  );
  return result.rows[0];
}

/**
 * Aprova manualmente uma empresa, definindo status = 'ativo'
 * @param {number} id_empresa 
 */
async function aprovarEmpresa(id_empresa) {
  const result = await db.query(
    `UPDATE empresas 
        SET status = 'ativo' 
      WHERE id_empresa = $1 
      RETURNING *`,
    [id_empresa]
  );
  return result.rows[0];
}

/**
 * Cria a empresa para um gestor e associa o usuário (id_usuario) à empresa.
 * Insere os dados na tabela 'empresas' e cria a relação em 'usuario_empresa'.
 * @param {Object} empresaData - Dados da empresa (nome, endereco, contato, email_empresa, cnpj, senha, documento_url)
 * @param {number} userId - ID do usuário gestor
 */
async function createGestorEmpresa(empresaData, userId) {
  // Cria a empresa com status 'pendente'
  const novaEmpresa = await createEmpresa(empresaData);

  // Insere o relacionamento entre o usuário e a empresa
  // Assumindo que existe uma tabela "usuario_empresa" com colunas (id_usuario, id_empresa)
  await db.query(
    'INSERT INTO usuario_empresa (id_usuario, id_empresa) VALUES ($1, $2)',
    [userId, novaEmpresa.id_empresa]
  );

  return novaEmpresa;
}

// Exporta todas as funções do serviço
module.exports = {
  getOwnerById,
  getOwnerStripeAccountId,
  updateOwnerStripeAccountId,
  createEmpresa,
  aprovarEmpresa,
  createGestorEmpresa   // Nova função para o fluxo de Gestor
};
