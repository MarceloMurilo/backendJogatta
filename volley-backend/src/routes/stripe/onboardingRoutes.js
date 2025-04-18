const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../../config/db');

// ✅ Criação da conta Stripe
router.post('/create-stripe-account', async (req, res) => {
  const { id_empresa, email } = req.body;

  try {
    const account = await stripe.accounts.create({
      type: 'custom',
      country: 'BR',
      email,
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
      business_type: 'individual'
    });

    await db.query(
      'UPDATE empresas SET stripe_account_id = $1 WHERE id_empresa = $2',
      [account.id, id_empresa]
    );

    res.status(200).json({
      message: 'Conta Stripe criada com sucesso.',
      stripe_account_id: account.id
    });
  } catch (error) {
    console.error('❌ Erro ao criar conta Stripe:', error.message);
    res.status(500).json({ error: 'Erro ao criar conta Stripe Connect.' });
  }
});

// ✅ Link de onboarding
router.post('/create-account-link', async (req, res) => {
  const { id_empresa } = req.body;

  try {
    const result = await db.query(
      'SELECT stripe_account_id FROM empresas WHERE id_empresa = $1',
      [id_empresa]
    );

    const stripe_account_id = result.rows[0]?.stripe_account_id;

    if (!stripe_account_id) {
      return res.status(404).json({ error: 'Conta Stripe não encontrada para esta empresa.' });
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripe_account_id,
      refresh_url: 'https://jogatta.netlify.app/erro-conexao',
      return_url: 'https://jogatta.netlify.app/sucesso-conexao',
      type: 'account_onboarding'
    });

    res.status(200).json({ url: accountLink.url });
  } catch (error) {
    console.error('❌ Erro ao criar link de onboarding Stripe:', error.message);
    res.status(500).json({ error: 'Erro ao criar link de onboarding Stripe.' });
  }
});

// ✅ Atualizar dados pessoais
router.post('/update-account', async (req, res) => {
  const { stripe_account_id, nome_completo, cpf, nascimento, endereco } = req.body;

  try {
    const [first_name, ...resto] = nome_completo.split(' ');
    const last_name = resto.join(' ') || ' ';

    await stripe.accounts.update(stripe_account_id, {
      individual: {
        first_name,
        last_name,
        id_number: cpf.replace(/\D/g, ''),
        dob: {
          day: parseInt(nascimento.split('-')[2]),
          month: parseInt(nascimento.split('-')[1]),
          year: parseInt(nascimento.split('-')[0]),
        },
        address: {
          line1: endereco.rua,
          city: endereco.cidade,
          state: endereco.estado,
          postal_code: endereco.cep.replace(/\D/g, ''),
          country: 'BR',
        }
      },
      tos_acceptance: {
        date: Math.floor(Date.now() / 1000),
        ip: req.ip
      }
    });
    
    // Subs código - Atualiza stripe_onboarding_completo
    await db.query(
      'UPDATE empresas SET stripe_onboarding_completo = true WHERE stripe_account_id = $1',
      [stripe_account_id]
    );

    res.status(200).json({ message: 'Dados pessoais enviados ao Stripe com sucesso.' });
  } catch (error) {
    console.error('❌ Erro ao atualizar conta Stripe:', error.message);
    res.status(500).json({ error: 'Erro ao atualizar dados no Stripe.' });
  }
});

// ✅ Adicionar conta bancária
router.post('/add-bank-account', async (req, res) => {
  const { stripe_account_id, nome_titular, tipo, banco, agencia, conta } = req.body;

  try {
    const routing_number = `${banco}${agencia}`;
    const account_number = conta.replace(/\D/g, '');

    console.log('📦 Enviando dados bancários:', {
      stripe_account_id,
      routing_number,
      account_number,
      nome_titular,
      tipo
    });

    const externalAccount = await stripe.accounts.createExternalAccount(stripe_account_id, {
      external_account: {
        object: 'bank_account',
        country: 'BR',
        currency: 'BRL',
        account_holder_name: nome_titular,
        account_holder_type: tipo,
        routing_number: routing_number,
        account_number: account_number
      }
    });

    res.status(200).json({ message: 'Conta bancária adicionada com sucesso.', externalAccount });
  } catch (error) {
    console.error('❌ Erro ao adicionar conta bancária:', error.message);
    res.status(500).json({ error: 'Erro ao adicionar conta bancária no Stripe.' });
  }
});

// ✅ Status da conta
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

    res.status(200).json({
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      requirements: account.requirements
    });
  } catch (error) {
    console.error('❌ Erro ao verificar status da conta Stripe:', error.message);
    res.status(500).json({ error: 'Erro ao verificar status da conta Stripe.' });
  }
});

module.exports = router;
