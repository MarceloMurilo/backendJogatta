// src/routes/stripe/paymentRoutes.js
const express = require('express');
const router = express.Router();
const stripe = require('../../../src/config/stripe.js');
const pool = require('../../config/db'); // ✅ IMPORTANTE
const { getOwnerStripeAccountId } = require('../../services/ownerService');
const { createTransaction } = require('../../services/stripe/paymentService.js');

/**
 * Cria um PaymentIntent no Stripe, salva transação no banco
 * e retorna o client_secret para o front-end completar o pagamento.
 */
router.post('/create-payment-intent', async (req, res) => {
  const { amount, currency, ownerId, reservaId, id_usuario } = req.body;

  console.log('🧾 Criando pagamento com os dados recebidos:');
  console.log('➡️ amount:', amount);
  console.log('➡️ currency:', currency);
  console.log('➡️ ownerId:', ownerId);
  console.log('➡️ reservaId:', reservaId);
  console.log('➡️ id_usuario:', id_usuario);

  try {
    // 👉 Consulta o id_empresa da reserva se ownerId não for passado
    let idEmpresa = ownerId;
    if (!idEmpresa) {
      const result = await pool.query(`
        SELECT q.id_empresa
        FROM reservas r
        JOIN quadras q ON r.id_quadra = q.id_quadra
        WHERE r.id_reserva = $1
      `, [reservaId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Reserva ou empresa não encontrada' });
      }

      idEmpresa = result.rows[0].id_empresa;
    }

    // 🔁 Busca o stripe_account_id com base no id_empresa
    const ownerStripeAccountId = await getOwnerStripeAccountId(idEmpresa);
    console.log('🔁 Stripe Account ID retornado:', ownerStripeAccountId);

    if (!ownerStripeAccountId || ownerStripeAccountId === 'null') {
      console.log('❌ Dono da quadra sem conta Stripe conectada');
      return res.status(400).json({ error: 'Dono da quadra não possui conta Stripe conectada.' });
    }

    // 2) Calcula taxa e repasse
    const taxaJogatta = Math.round(amount * 0.10); // 10%
    const valorRepasse = amount - taxaJogatta;

    // 3) Cria PaymentIntent no Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      transfer_data: {
        destination: ownerStripeAccountId,
      },
      application_fee_amount: taxaJogatta,
      description: 'Reserva de quadra Jogatta',
    });

    console.log('✅ PaymentIntent criado:', paymentIntent.id);

    // 4) Salva transação no banco
    await createTransaction({
      id_reserva: reservaId,
      id_usuario,
      stripe_payment_intent_id: paymentIntent.id,
      valor_total: amount,
      valor_repasse: valorRepasse,
      taxa_jogatta: taxaJogatta,
      status: paymentIntent.status,
    });

    // 5) Retorna clientSecret
    res.send({
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status,
      message: 'PaymentIntent criado com sucesso!',
    });

  } catch (err) {
    console.error('❌ Erro ao criar Payment Intent:', err);
    res.status(500).json({ error: 'Erro ao criar Payment Intent.' });
  }
});

module.exports = router;
