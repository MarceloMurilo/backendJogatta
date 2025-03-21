// ============================
// 📄 src/routes/stripeConnectRoutes.js
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../config/db');

// Criar conta conectada teste
router.post('/create-stripe-account', async (req, res) => {
  const { id_empresa, email } = req.body;

  try {
    const account = await stripe.accounts.create({
      type: 'standard',
      country: 'BR',
      email: email,
      capabilities: { transfers: { requested: true } },
    });

    // Atualiza no banco
    await db.query('UPDATE empresas SET stripe_account_id = $1 WHERE id_empresa = $2', [account.id, id_empresa]);

    res.status(200).json({ message: 'Conta Stripe Connect criada.', accountId: account.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar conta Stripe Connect.' });
  }
});

module.exports = router;
