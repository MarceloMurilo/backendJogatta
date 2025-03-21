// src/services/paymentService.js
// Serviço responsável por interagir com o banco para atualizar informações de pagamento.

const db = require('../config/db'); // Importa a configuração de conexão com o banco de dados

/**
 * Atualiza o status do pagamento na tabela transacoes_pagamento.
 * @param {string} paymentIntentId - ID do PaymentIntent do Stripe.
 * @param {string} status - Novo status do pagamento (ex: 'succeeded', 'failed').
 */
async function updatePaymentStatus(paymentIntentId, status) {
  const query = `
    UPDATE transacoes_pagamento
       SET status = $1,
           data_conclusao = NOW()
     WHERE stripe_payment_intent_id = $2
  `;
  await db.query(query, [status, paymentIntentId]);
}

module.exports = {
  updatePaymentStatus,
};
