// src/routes/stripeWebhook.js
// Este arquivo contém o endpoint para lidar com webhooks do Stripe.

const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const { updatePaymentStatus } = require('../services/paymentService');

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // Defina esta variável de ambiente

router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Erro ao verificar assinatura do webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('Pagamento bem-sucedido:', paymentIntent.id);
      updatePaymentStatus(paymentIntent.id, 'succeeded');
      break;
    case 'payment_intent.payment_failed':
      const paymentFailedIntent = event.data.object;
      console.log('Pagamento falhou:', paymentFailedIntent.id);
      updatePaymentStatus(paymentFailedIntent.id, 'failed');
      break;
    default:
      console.log(`Evento não tratado: ${event.type}`);
  }

  res.json({ received: true });
});

module.exports = router;
