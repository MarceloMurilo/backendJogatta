const express = require('express');
const router = express.Router();
const stripe = require('../../config/stripe');
const { getOwnerById, updateOwnerStripeAccountId } = require('../../services/ownerService');

router.post('/create-stripe-account-link', async (req, res) => {
  const { ownerId } = req.body;
  console.log(`➡️ Requisição recebida para criar onboarding do ownerId: ${ownerId}`);

  try {
    const owner = await getOwnerById(ownerId);
    if (!owner) {
      console.log(`❌ Dono da quadra com ID ${ownerId} não encontrado no banco.`);
      return res.status(404).json({ error: 'Dono da quadra não encontrado.' });
    }

    console.log(`✅ Dono encontrado: ${owner.email}, verificando Stripe Account...`);

    let accountId = owner.stripeAccountId;
    if (!accountId) {
      console.log(`ℹ️ Dono ainda não possui conta Stripe. Criando nova conta...`);
      const account = await stripe.accounts.create({
        type: 'standard',
        country: 'BR',
        email: owner.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      console.log(`✅ Conta Stripe criada com ID: ${accountId}`);

      await updateOwnerStripeAccountId(ownerId, accountId);
      console.log(`✅ Stripe Account ID salvo no banco para ownerId ${ownerId}`);
    } else {
      console.log(`ℹ️ Dono já possui Stripe Account ID: ${accountId}`);
    }

    console.log(`➡️ Criando onboarding link para Account ID: ${accountId}`);
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: 'https://seusite.com/reauth',
      return_url: 'https://seusite.com/success',
      type: 'account_onboarding',
    });

    console.log(`✅ Onboarding link criado: ${accountLink.url}`);
    res.json({ url: accountLink.url });

  } catch (err) {
    console.error('🔥 Erro detalhado:', err);
    res.status(500).json({ error: 'Erro ao criar link de onboarding.' });
  }
});

module.exports = router;
