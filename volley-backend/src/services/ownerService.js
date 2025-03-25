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
 * @param {*} param0 Objeto com { nome, endereco, contato, email_empresa, cnpj, senha, documento_url, id_usuario }
 */
async function createEmpresa({ nome, endereco, contato, email_empresa, cnpj, senha, documento_url, id_usuario }) {
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    // Hash da senha
    const hashedSenha = await bcrypt.hash(senha, 10);
    
    // Inserir a empresa
    const result = await client.query(
      `INSERT INTO empresas 
         (nome, endereco, contato, email_empresa, cnpj, senha, documento_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente')
       RETURNING *`,
      [nome, endereco, contato, email_empresa, cnpj, hashedSenha, documento_url]
    );
    
    const empresa = result.rows[0];
    
    // Se houver um ID de usuário, vincular ao usuário
    if (id_usuario) {
      await client.query(
        `INSERT INTO usuario_empresa (id_usuario, id_empresa, data_criacao)
         VALUES ($1, $2, NOW())`,
        [id_usuario, empresa.id_empresa]
      );
      
      // Atualizar o papel do usuário para "gestor"
      await client.query(
        `UPDATE usuario
         SET papel_usuario = 'gestor'
         WHERE id_usuario = $1`,
        [id_usuario]
      );
    }
    
    await client.query('COMMIT');
    return empresa;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar empresa:', error);
    throw error;
  } finally {
    client.release();
  }
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
 * Busca a empresa vinculada a um usuário
 * @param {number} id_usuario
 */
async function getEmpresaByUsuario(id_usuario) {
  const result = await db.query(
    `SELECT e.*
     FROM empresas e
     JOIN usuario_empresa ue ON e.id_empresa = ue.id_empresa
     WHERE ue.id_usuario = $1
     LIMIT 1`,
    [id_usuario]
  );
  return result.rows[0] || null;
}

// Exporta todas as funções do serviço
module.exports = {
  getOwnerById,
  getOwnerStripeAccountId,
  updateOwnerStripeAccountId,
  createEmpresa,
  aprovarEmpresa,
  getEmpresaByUsuario  // Nova função
};