// src/config/stripe.js
// Este arquivo configura o cliente Stripe com a chave secreta da API.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY); // Certifique-se de definir a variável de ambiente STRIPE_SECRET_KEY

module.exports = stripe;
