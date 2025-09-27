// Ensure .env is loaded when this module is imported during development.
import 'dotenv/config';

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`ENV ${name} is required`);
  return v;
};

export const JWT_SECRET = need('JWT_SECRET');
export const JWT_REFRESH_SECRET = need('JWT_REFRESH_SECRET');
export const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL ?? '15m';
export const REFRESH_TOKEN_TTL = process.env.REFRESH_TOKEN_TTL ?? '30d';

export default {
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
};
