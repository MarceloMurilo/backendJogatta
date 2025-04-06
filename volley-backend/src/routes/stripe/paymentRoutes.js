// src/routes/stripe/paymentRoutes.js
const express = require('express');
const router = express.Router();
const stripe = require('../../../src/config/stripe.js');
const { getOwnerStripeAccountId } = require('../../services/ownerService');
const { createTransaction } = require('../../services/paymentService');

router.post('/create-payment-intent', async (req, res) => {
  const { amount, currency, ownerId, reservaId } = req.body;

  try {
    const ownerStripeAccountId = await getOwnerStripeAccountId(ownerId);
    if (!ownerStripeAccountId) {
      return res.status(400).json({ error: 'Dono da quadra não possui conta Stripe conectada.' });
    }

    // Calcula taxa e repasse
    const taxaJogatta = Math.round(amount * 0.10); // 10% taxa
    const valorRepasse = amount - taxaJogatta;

    // Cria PaymentIntent já com método de pagamento e confirmação automática para teste
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      // payment_method_types: ['card'],
      // payment_method: 'pm_card_visa', // <-- método de teste VISA
      // confirm: true, // confirma automaticamente
      transfer_data: {
        destination: ownerStripeAccountId,
      },
      application_fee_amount: taxaJogatta,
      description: 'Reserva de quadra Jogatta',
    });

    // Salva transação no banco
    await createTransaction({
      id_reserva: reservaId,
      stripe_payment_intent_id: paymentIntent.id,
      valor_total: amount,
      valor_repasse: valorRepasse,
      taxa_jogatta: taxaJogatta,
      status: paymentIntent.status, // pode salvar o status já direto
    });

    // Retorna client secret pro mobile (ou debug)
    res.send({
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status,
      message: 'PaymentIntent criado e confirmado!',
    });

  } catch (err) {
    console.error('Erro ao criar Payment Intent:', err);
    res.status(500).json({ error: 'Erro ao criar Payment Intent.' });
  }
});

module.exports = router;
