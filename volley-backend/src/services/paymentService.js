const db = require('../config/db');

/**
 * Cria uma nova entrada na tabela transacoes_pagamento.
 * @param {Object} data - Dados da transação.
 * @param {number} data.id_reserva - ID da reserva relacionada.
 * @param {string} data.stripe_payment_intent_id - ID do PaymentIntent do Stripe.
 * @param {number} data.valor_total - Valor total da transação (em centavos).
 * @param {number} data.valor_repasse - Valor que será repassado (em centavos).
 * @param {number} data.taxa_jogatta - Taxa cobrada pelo Jogatta (em centavos).
 */
async function createTransaction({
  id_reserva,
  stripe_payment_intent_id,
  valor_total,
  valor_repasse,
  taxa_jogatta
}) {
  const query = `
    INSERT INTO transacoes_pagamento
      (id_reserva, stripe_payment_intent_id, valor_total, valor_repasse, taxa_jogatta, status, data_criacao)
    VALUES
      ($1, $2, $3, $4, $5, 'pending', NOW())
  `;
  await db.query(query, [id_reserva, stripe_payment_intent_id, valor_total, valor_repasse, taxa_jogatta]);
}

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
  createTransaction,
  updatePaymentStatus,
};
