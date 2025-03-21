// src/routes/paymentRoutes.js
// Este arquivo contém a rota para criar um Payment Intent com repasse automático para o dono da quadra.

const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const { getOwnerStripeAccountId } = require('../services/ownerService');

router.post('/create-payment-intent', async (req, res) => {
  const { amount, currency, ownerId } = req.body;

  try {
    const ownerStripeAccountId = await getOwnerStripeAccountId(ownerId);
    if (!ownerStripeAccountId) {
      return res.status(400).json({ error: 'Dono da quadra não possui conta Stripe conectada.' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method_types: ['card'],
      transfer_data: {
        destination: ownerStripeAccountId,
      },
      application_fee_amount: Math.round(amount * 0.10), // Taxa de 10% para o Jogatta
    });

    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Erro ao criar Payment Intent:', err);
    res.status(500).json({ error: 'Erro ao criar Payment Intent.' });
  }
});

module.exports = router;
