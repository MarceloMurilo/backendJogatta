const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY); // Coloque no .env

module.exports = stripe;
