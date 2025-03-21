// src/services/paymentService.js
// Este arquivo contém funções para gerenciar dados de pagamentos.

const db = require('../config/db'); // Configuração do banco de dados

async function updatePaymentStatus(paymentIntentId, status) {
  await db.query('UPDATE pagamentos SET status = $1 WHERE payment_intent_id = $2', [status, paymentIntentId]);
}

module.exports = {
  updatePaymentStatus,
};
