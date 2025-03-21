// src/services/ownerService.js
// Este arquivo contém funções para gerenciar dados dos donos de quadra.

const db = require('../config/db'); // Configuração do banco de dados

async function getOwnerById(ownerId) {
  const result = await db.query('SELECT * FROM owners WHERE id = $1', [ownerId]);
  return result.rows[0];
}

async function getOwnerStripeAccountId(ownerId) {
  const result = await db.query('SELECT stripe_account_id FROM owners WHERE id = $1', [ownerId]);
  return result.rows[0]?.stripe_account_id || null;
}

async function updateOwnerStripeAccountId(ownerId, accountId) {
  await db.query('UPDATE owners SET stripe_account_id = $1 WHERE id = $2', [accountId, ownerId]);
}

module.exports = {
  getOwnerById,
  getOwnerStripeAccountId,
  updateOwnerStripeAccountId,
};
