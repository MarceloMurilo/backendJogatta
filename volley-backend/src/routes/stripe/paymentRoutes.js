// src/routes/stripe/paymentRoutes.js
const express = require('express');
const router = express.Router();
const stripe = require('../../../src/config/stripe.js');
const { getOwnerStripeAccountId } = require('../../services/ownerService');
const { createTransaction } = require('../../services/stripe/paymentService.js');

/**
 * Cria um PaymentIntent no Stripe, salva transação no banco
 * e retorna o client_secret para o front-end completar o pagamento.
 *
 * Exemplo de body esperado:
 * {
 *   "amount": 5000,         // em centavos
 *   "currency": "brl",
 *   "ownerId": 123,         // dono da quadra
 *   "reservaId": 456,       // reserva associada
 *   "id_usuario": 789       // jogador que está pagando
 * }
 */
router.post('/create-payment-intent', async (req, res) => {
  const { amount, currency, ownerId, reservaId, id_usuario } = req.body;

  try {
    // 1) Obtem a conta Stripe do dono da quadra
    const ownerStripeAccountId = await getOwnerStripeAccountId(ownerId);
    if (!ownerStripeAccountId || ownerStripeAccountId === 'null') {
      return res.status(400).json({ error: 'Dono da quadra não possui conta Stripe conectada.' });
    }

    // 2) Calcula taxa e repasse
    const taxaJogatta = Math.round(amount * 0.10); // 10% taxa
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

    // 4) Salva transação no banco
    await createTransaction({
      id_reserva: reservaId,
      id_usuario, // novo campo que registra qual jogador pagou
      stripe_payment_intent_id: paymentIntent.id,
      valor_total: amount,
      valor_repasse,
      taxa_jogatta: taxaJogatta,
      status: paymentIntent.status, // pode ser 'pending', 'requires_payment_method', etc.
    });

    // 5) Retorna clientSecret para o front finalizar o pagamento (caso não esteja automático)
    res.send({
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status,
      message: 'PaymentIntent criado com sucesso!',
    });

  } catch (err) {
    console.error('Erro ao criar Payment Intent:', err);
    res.status(500).json({ error: 'Erro ao criar Payment Intent.' });
  }
});

module.exports = router;
