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
 * Atualiza o status do pagamento na tabela transacoes_pagamento
 * e atualiza também a tabela reservas com valor pago e status_reserva.
 * 
 * @param {string} paymentIntentId - ID do PaymentIntent do Stripe.
 * @param {string} status - Novo status do pagamento (ex: 'succeeded', 'failed').
 */
async function updatePaymentStatus(paymentIntentId, status) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Atualiza transação de pagamento
    await client.query(
      `
      UPDATE transacoes_pagamento
         SET status = $1,
             data_conclusao = NOW()
       WHERE stripe_payment_intent_id = $2
      `,
      [status, paymentIntentId]
    );

    if (status === 'succeeded') {
      // Busca id_reserva e valor do pagamento
      const result = await client.query(
        `SELECT id_reserva, valor_total FROM transacoes_pagamento WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId]
      );

      if (result.rows.length > 0) {
        const { id_reserva, valor_total } = result.rows[0];

        // Atualiza valor acumulado da reserva
        await client.query(
          `UPDATE reservas
             SET valor_pago = valor_pago + $1
           WHERE id_reserva = $2`,
          [valor_total, id_reserva]
        );

        // Verifica se atingiu percentual
        const reservaResult = await client.query(
          `SELECT r.valor_pago, q.preco_hora, q.percentual_antecipado
           FROM reservas r
           JOIN quadras q ON q.id_quadra = r.id_quadra
           WHERE r.id_reserva = $1`,
          [id_reserva]
        );

        if (reservaResult.rows.length > 0) {
          const { valor_pago, preco_hora, percentual_antecipado } = reservaResult.rows[0];
          const valorMinimo = (percentual_antecipado / 100) * preco_hora;

          if (valor_pago >= valorMinimo) {
            await client.query(
              `UPDATE reservas SET status_reserva = 'confirmada_parcial' WHERE id_reserva = $1`,
              [id_reserva]
            );
          }
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao atualizar pagamento:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createTransaction,
  updatePaymentStatus,
};
