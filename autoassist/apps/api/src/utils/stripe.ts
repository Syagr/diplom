import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error('ENV STRIPE_SECRET_KEY is required');

export const stripe = new Stripe(key, {
  apiVersion: '2024-06-20',
});

export default stripe;
