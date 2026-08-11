const encoder = new TextEncoder();

function hex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashApiKey(rawKey) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(rawKey))));
}

export async function createProCheckout(repository, stripe, catalog, options = {}) {
  const item = catalog?.subscription;
  if (
    item?.mode !== 'subscription'
    || !String(item?.price || '').startsWith('price_')
    || !String(item?.product || '').startsWith('prod_')
    || item?.currency !== 'usd'
    || item?.amount !== 489
  ) {
    throw new Error('Pro checkout is not configured');
  }
  if (!options.successUrl || !options.cancelUrl) throw new Error('Pro checkout return URLs are not configured');

  const generateAccountId = options.generateAccountId || (() => `acct_${crypto.randomUUID()}`);
  const accountId = String(generateAccountId());
  if (!/^acct_[0-9a-z-]+$/i.test(accountId)) throw new Error('Invalid generated account ID');

  await repository.createPendingAccount(accountId);
  let session;
  try {
    session = await stripe.createCheckoutSession({
      accountId,
      sku: 'subscription',
      mode: item.mode,
      priceId: item.price,
      productId: item.product,
      currency: item.currency,
      amount: item.amount,
      successUrl: options.successUrl,
      cancelUrl: options.cancelUrl,
    });
  } catch (error) {
    await repository.markCheckoutFailed(accountId);
    throw error;
  }
  if (!session?.id || !session?.url) throw new Error('Stripe checkout session was not created');
  return { accountId, sessionId: session.id, checkoutUrl: session.url };
}

export async function authenticateApiKey(repository, rawKey) {
  if (!/^sg_[0-9a-f]{48}$/i.test(String(rawKey || ''))) throw new Error('Invalid API key');
  const digest = await hashApiKey(rawKey);
  const account = await repository.findAccountByKeyDigest(digest);
  if (!account || account.active === false) throw new Error('Invalid API key');
  return account;
}

export function validateCheckoutSession(session, catalog, expected = {}) {
  const sku = session?.metadata?.spydergoat_sku;
  const item = catalog?.[sku];
  const line = session?.line_items?.data;
  const price = line?.[0]?.price;
  const accountId = session?.metadata?.spydergoat_account_id;
  const checks = [
    session?.status === 'complete',
    session?.payment_status === 'paid',
    session?.livemode === expected.livemode,
    Boolean(session?.customer),
    Boolean(item),
    session?.mode === item?.mode,
    session?.currency === item?.currency,
    session?.amount_total === item?.amount,
    line?.length === 1,
    line?.[0]?.quantity === 1,
    price?.id === item?.price,
    price?.product === item?.product,
    price?.unit_amount === item?.amount,
    price?.currency === item?.currency,
    Boolean(accountId),
    !expected.accountId || accountId === expected.accountId,
  ];
  return checks.every(Boolean)
    ? { ok: true, sku, accountId, customerId: session.customer, item }
    : { ok: false, error: 'Checkout session failed closed validation' };
}

export async function consumePaidRequest(repository, accountId) {
  return repository.consumeAllowance(accountId);
}

export async function processStripeEvent(repository, event, catalog, options = {}) {
  if (event?.type !== 'checkout.session.completed') return { ignored: true };
  if (!event.id) throw new Error('Stripe event ID is required');
  const session = event.data?.object;
  const accountId = session?.metadata?.spydergoat_account_id;
  if (!accountId) throw new Error('Deterministic account binding is required');
  const validation = validateCheckoutSession(session, catalog, { livemode: options.livemode, accountId });
  if (!validation.ok) throw new Error(validation.error);

  const command = validation.item.mode === 'subscription'
    ? { kind: 'provision', accountId, customerId: validation.customerId }
    : { kind: 'credit', accountId, customerId: validation.customerId, credits: validation.item.credits };
  const result = await repository.applyStripeEventOnce(event.id, command);
  options.logger?.info?.('stripe_event_processed', { eventId: event.id, type: event.type, replayed: Boolean(result.replayed) });
  return result;
}
