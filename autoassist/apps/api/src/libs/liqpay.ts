export async function createCheckout(amountUAH: number, orderId: number) {
  // здесь можешь дернуть LiqPay SDK/Stripe Checkout
  // пока отдаём фейковый URL для демо
  return { url: `https://checkout.example/pay?order=${orderId}&amount=${amountUAH}` };
}