const STRIPE_CHECKOUT_ENDPOINT = 'https://api.stripe.com/v1/checkout/sessions';
const STRIPE_PRICE_ENDPOINT = 'https://api.stripe.com/v1/prices';

function required(value, name) {
  if (!String(value || '').trim()) throw new Error(`${name} is required`);
  return String(value);
}

export class StripeBillingClient {
  constructor(secretKey, options = {}) {
    this.secretKey = required(secretKey, 'Stripe secret key');
    this.fetcher = options.fetcher || globalThis.fetch;
    if (typeof this.fetcher !== 'function') throw new Error('Stripe fetch implementation is required');
  }

  async createCheckoutSession(command) {
    const accountId = required(command?.accountId, 'Checkout account ID');
    const sku = required(command?.sku, 'Checkout SKU');
    const mode = required(command?.mode, 'Checkout mode');
    const priceId = required(command?.priceId, 'Checkout price ID');
    const productId = required(command?.productId, 'Checkout product ID');
    const currency = required(command?.currency, 'Checkout currency');
    const amount = Number(command?.amount);
    const successUrl = required(command?.successUrl, 'Checkout success URL');
    const cancelUrl = required(command?.cancelUrl, 'Checkout cancel URL');

    if (mode !== 'subscription' || sku !== 'subscription') {
      throw new Error('Only the Pro subscription checkout is enabled');
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Checkout amount is invalid');

    const priceResponse = await this.fetcher(`${STRIPE_PRICE_ENDPOINT}/${encodeURIComponent(priceId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    const price = await priceResponse.json().catch(() => null);
    const returnedProduct = typeof price?.product === 'string' ? price.product : price?.product?.id;
    if (
      !priceResponse.ok
      || price?.id !== priceId
      || price?.active !== true
      || price?.currency !== currency
      || price?.unit_amount !== amount
      || price?.type !== 'recurring'
      || price?.recurring?.interval !== 'month'
      || returnedProduct !== productId
    ) {
      throw new Error('Stripe catalog does not match the configured Pro subscription');
    }

    const body = new URLSearchParams({
      mode,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: accountId,
      'metadata[spydergoat_sku]': sku,
      'metadata[spydergoat_account_id]': accountId,
      'subscription_data[metadata][spydergoat_sku]': sku,
      'subscription_data[metadata][spydergoat_account_id]': accountId,
    });

    const response = await this.fetcher(STRIPE_CHECKOUT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `spydergoat-checkout-${accountId}`,
      },
      body,
    });

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Stripe checkout failed with status ${response.status}`);
    }
    if (!response.ok) throw new Error(`Stripe checkout failed with status ${response.status}`);

    const checkoutUrl = new URL(required(result?.url, 'Stripe checkout URL'));
    if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
      throw new Error('Stripe returned an invalid checkout URL');
    }
    return { id: required(result?.id, 'Stripe checkout session ID'), url: checkoutUrl.toString() };
  }
}
