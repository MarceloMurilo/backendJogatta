// src/routes/owner/stripeConnectRoutes.js
// Este arquivo contém a rota para o dono da quadra criar/conectar sua conta Stripe.

const express = require('express');
const router = express.Router();
const stripe = require('../../config/stripe');
const { getOwnerById, updateOwnerStripeAccountId } = require('../../services/ownerService');

router.post('/create-stripe-account-link', async (req, res) => {
  const { ownerId } = req.body;

  try {
    const owner = await getOwnerById(ownerId);
    if (!owner) {
      return res.status(404).json({ error: 'Dono da quadra não encontrado.' });
    }

    let accountId = owner.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
        country: 'BR',
        email: owner.email,
        capabilities: {
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      await updateOwnerStripeAccountId(ownerId, accountId);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: 'https://seusite.com/reauth',
      return_url: 'https://seusite.com/success',
      type: 'account_onboarding',
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error('Erro ao criar link de onboarding:', err);
    res.status(500).json({ error: 'Erro ao criar link de onboarding.' });
  }
});

module.exports = router;
