const db = require('../config/db'); // Configuração do banco de dados
const bcrypt = require('bcryptjs'); // Hash senhas
 
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
 * Cria uma nova empresa com senha, cnpj etc. (status inicial = 'pendente')
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

// Exporta todas as funções do serviço
module.exports = {
  getOwnerById,
  getOwnerStripeAccountId,
  updateOwnerStripeAccountId,
  createEmpresa,      // novo
  aprovarEmpresa      // novo
};
