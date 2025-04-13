// src/services/stripe/paymentService.js
const db = require('../../config/db');

/**
 * Cria uma nova entrada na tabela transacoes_pagamento.
 *
 * Obs: Agora com id_usuario, para sabermos qual jogador fez o pagamento.
 */
async function createTransaction({
  id_reserva,
  id_usuario,
  stripe_payment_intent_id,
  valor_total,
  valor_repasse,
  taxa_jogatta,
  status
}) {
  const query = `
    INSERT INTO transacoes_pagamento
      (id_reserva, id_usuario, stripe_payment_intent_id, valor_total, valor_repasse, taxa_jogatta, status, data_criacao)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, NOW())
  `;
  await db.query(query, [
    id_reserva,
    id_usuario,
    stripe_payment_intent_id,
    valor_total,
    valor_repasse,
    taxa_jogatta,
    status || 'pending' // caso queira forçar 'pending'
  ]);
}

/**
 * Atualiza o status do pagamento na tabela transacoes_pagamento
 * e atualiza também a tabela reservas com valor pago e status_reserva,
 * e por fim atualiza participacao_jogos (status = 'ativo', pagamento_confirmado = true).
 *
 * É aqui que você chamará quando receber o webhook do Stripe confirmando o pagamento.
 */
async function updatePaymentStatus(paymentIntentId, status) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // 1) Atualiza transacao_pagamento
    await client.query(
      `UPDATE transacoes_pagamento
          SET status = $1,
              data_conclusao = NOW()
        WHERE stripe_payment_intent_id = $2`,
      [status, paymentIntentId]
    );

    // 2) Se pagamento concluído com sucesso, atualiza reservas e participacao_jogos
    if (status === 'succeeded') {
      // a) Busca id_reserva, valor e id_usuario (quem pagou)
      const result = await client.query(
        `SELECT id_reserva, valor_total, id_usuario
           FROM transacoes_pagamento
          WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId]
      );

      if (result.rows.length > 0) {
        const { id_reserva, valor_total, id_usuario } = result.rows[0];

        // b) Atualiza valor_pago na tabela reservas
        await client.query(
          `UPDATE reservas
              SET valor_pago = valor_pago + $1
            WHERE id_reserva = $2`,
          [valor_total, id_reserva]
        );

        // c) Verifica se atingiu valor mínimo (ex: confirmada_parcial)
        const reservaResult = await client.query(
          `SELECT r.valor_pago,
                  q.preco_hora,
                  q.percentual_antecipado,
                  j.id_jogo
             FROM reservas r
             JOIN quadras q ON q.id_quadra = r.id_quadra
             JOIN jogos j   ON j.id_jogo = r.id_jogo
            WHERE r.id_reserva = $1
          `,
          [id_reserva]
        );

        if (reservaResult.rows.length > 0) {
          const {
            valor_pago,
            preco_hora,
            percentual_antecipado,
            id_jogo
          } = reservaResult.rows[0];

          // cálculo do valor mínimo
          const valorMinimo = (percentual_antecipado / 100) * preco_hora;
          if (valor_pago >= valorMinimo) {
            await client.query(
              `UPDATE reservas
                  SET status_reserva = 'confirmada_parcial'
                WHERE id_reserva = $1`,
              [id_reserva]
            );
          }

          // d) Atualiza participacao_jogos -> status=ativo, pagamento_confirmado=true
          await client.query(
            `UPDATE participacao_jogos
                SET status = 'ativo',
                    pagamento_confirmado = TRUE
              WHERE id_jogo = $1
                AND id_usuario = $2`,
            [id_jogo, id_usuario]
          );
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
