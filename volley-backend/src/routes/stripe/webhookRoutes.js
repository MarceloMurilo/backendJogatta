// src/routes/stripe/stripeWebhook.js
// Rota para lidar com Webhooks recebidos do Stripe.

const express = require('express');
const router = express.Router();
const stripe = require('../../../config/stripe');
const { updatePaymentStatus } = require('../../services/paymentService');
const pool = require('../../../config/db');

// Variável ambiente contendo o segredo do webhook configurado no painel do Stripe
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  // Verificação da assinatura do evento para garantir segurança
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Erro ao verificar assinatura do webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Lógica para tratar diferentes tipos de eventos
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        console.log(`Pagamento bem-sucedido! PaymentIntent ID: ${paymentIntent.id}`);
        await updatePaymentStatus(paymentIntent.id, 'succeeded');
        break;

      case 'payment_intent.payment_failed':
        const paymentFailedIntent = event.data.object;
        console.log(`Pagamento falhou. PaymentIntent ID: ${paymentFailedIntent.id}`);
        await updatePaymentStatus(paymentFailedIntent.id, 'failed');
        break;

        case 'account.updated':
  const account = event.data.object;

  if (account.details_submitted) {
    try {
      await pool.query(
        'UPDATE empresas SET stripe_onboarding_completo = TRUE WHERE stripe_account_id = $1',
        [account.id]
      );
      console.log(`Stripe onboarding finalizado para a conta ${account.id}`);
    } catch (err) {
      console.error('Erro ao atualizar onboarding da empresa:', err.message);
    }
  }
  break;


      default:
        console.log(`Evento não tratado: ${event.type}`);
    }

    // Responde ao Stripe que o evento foi recebido com sucesso
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Erro ao processar evento do Stripe:', error.message);
    res.status(500).send('Erro interno');
  }
});

module.exports = router;
