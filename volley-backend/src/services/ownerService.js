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

/**
 * Cria uma nova empresa com senha, CNPJ etc. (status inicial = 'pendente')
 * @param {*} param0 Objeto com { nome, endereco, contato, email_empresa, cnpj, senha, documento_url }
 */
async function createEmpresa({ nome, endereco, contato, email_empresa, cnpj, senha, documento_url, stripe_account_id }) {
  const hashedSenha = await bcrypt.hash(senha, 10); // Gera hash seguro da senha
  const result = await db.query(
    `INSERT INTO empresas 
       (nome, endereco, contato, email_empresa, cnpj, senha, documento_url, status, stripe_account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', $8)
     RETURNING *`,
    [nome, endereco, contato, email_empresa, cnpj, hashedSenha, documento_url, stripe_account_id]
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
  
  // Verificação para debug
  console.log('Nova empresa criada:', novaEmpresa);
  console.log('ID do usuário gestor:', userId);
  
  // Verificar se o userId é válido
  if (!userId) {
    throw new Error('ID do usuário não fornecido para associação com a empresa');
  }

  // Insere o relacionamento entre o usuário e a empresa
  const relationship = await db.query(
    'INSERT INTO usuario_empresa (id_usuario, id_empresa) VALUES ($1, $2) RETURNING *',
    [userId, novaEmpresa.id_empresa]
  );
  
  console.log('Relação criada:', relationship.rows[0]);

  // Verificar se o papel do usuário está correto
  const userRole = await db.query(
    'SELECT papel_usuario FROM usuario WHERE id_usuario = $1',
    [userId]
  );
  
  // Se o usuário não for gestor, atualiza o papel
  if (userRole.rows.length > 0 && userRole.rows[0].papel_usuario !== 'gestor') {
    await db.query(
      'UPDATE usuario SET papel_usuario = $1 WHERE id_usuario = $2',
      ['gestor', userId]
    );
    console.log('Papel do usuário atualizado para gestor');
  }

  return novaEmpresa;
}

// Exporta todas as funções do serviço
module.exports = {
  getOwnerById,
  getOwnerStripeAccountId,
  updateOwnerStripeAccountId,
  createEmpresa,
  aprovarEmpresa,
  createGestorEmpresa   // Função corrigida para o fluxo de Gestor
};