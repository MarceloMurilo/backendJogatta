const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../config/db');

// ✅ [POST] Criação da conta Stripe
router.post('/create-stripe-account', async (req, res) => {
  const { id_empresa, email } = req.body;

  try {
    const account = await stripe.accounts.create({
      type: 'standard',
      country: 'BR',
      email,
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true }
      }
    });

    await db.query(
      'UPDATE empresas SET stripe_account_id = $1 WHERE id_empresa = $2',
      [account.id, id_empresa]
    );

    res.status(200).json({
      message: 'Conta Stripe Connect criada com sucesso.',
      accountId: account.id
    });
  } catch (error) {
    console.error('Erro ao criar conta Stripe:', error.message);
    res.status(500).json({ error: 'Erro ao criar conta Stripe Connect.' });
  }
});


// ✅ [POST] Criar link de onboarding
router.post('/create-account-link', async (req, res) => {
  const { id_empresa } = req.body;

  try {
    const empresa = await db.query(
      'SELECT stripe_account_id FROM empresas WHERE id_empresa = $1',
      [id_empresa]
    );

    const stripeId = empresa.rows[0]?.stripe_account_id;

    if (!stripeId) {
      return res.status(400).json({ error: 'Empresa não possui conta Stripe ainda.' });
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripeId,
      refresh_url: `${process.env.FRONTEND_URL}/stripe/erro`,
      return_url: `${process.env.FRONTEND_URL}/stripe/sucesso`,
      type: 'account_onboarding'
    });

    res.json({ url: accountLink.url });
  } catch (error) {
    console.error('Erro ao gerar link de onboarding:', error.message);
    res.status(500).json({ error: 'Erro ao gerar link do Stripe.' });
  }
});


// ✅ [GET] Verificar status da conta Stripe
router.get('/status/:id_empresa', async (req, res) => {
  const { id_empresa } = req.params;

  try {
    const empresa = await db.query(
      'SELECT stripe_account_id FROM empresas WHERE id_empresa = $1',
      [id_empresa]
    );

    const stripeId = empresa.rows[0]?.stripe_account_id;

    if (!stripeId) {
      return res.status(400).json({ error: 'Empresa não possui conta Stripe.' });
    }

    const account = await stripe.accounts.retrieve(stripeId);

    res.json({
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      requirements: account.requirements
    });
  } catch (error) {
    console.error('Erro ao verificar status do Stripe:', error.message);
    res.status(500).json({ error: 'Erro ao verificar status da conta Stripe.' });
  }
});

module.exports = router;
