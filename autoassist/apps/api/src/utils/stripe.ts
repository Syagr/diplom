import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error('ENV STRIPE_SECRET_KEY is required');

// Do not pass apiVersion here to avoid TS union mismatch in dev.
export const stripe = new Stripe(key as string);

export default stripe;
