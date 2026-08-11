import { encryptApiKeyDelivery } from './key-delivery.js';

const encoder = new TextEncoder();
const DEFAULT_DELIVERY_TTL_SECONDS = 600;
const MAX_DELIVERY_TTL_SECONDS = 900;

function hex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function generateApiKey(fillRandom = bytes => crypto.getRandomValues(bytes)) {
  const bytes = new Uint8Array(24);
  const filled = fillRandom(bytes);
  if (filled !== bytes) throw new Error('API key random source must fill the supplied bytes');
  return `sg_${hex(bytes)}`;
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
  if (!account || (account.active !== true && account.active !== 1)) throw new Error('Invalid API key');
  return account;
}

export function validateCheckoutSession(session, catalog, expected = {}) {
  const sku = session?.metadata?.spydergoat_sku;
  const item = catalog?.[sku];
  const line = session?.line_items?.data;
  const price = line?.[0]?.price;
  const accountId = session?.metadata?.spydergoat_account_id;
  const subscription = session?.subscription;
  const subscriptionId = typeof subscription === 'string' ? subscription : subscription?.id;
  const productId = typeof price?.product === 'string' ? price.product : price?.product?.id;
  const checks = [
    session?.status === 'complete',
    session?.payment_status === 'paid',
    session?.livemode === expected.livemode,
    /^cus_[0-9a-z_]+$/i.test(String(session?.customer || '')),
    Boolean(item),
    session?.mode === 'subscription',
    item?.mode === 'subscription',
    session?.currency === item?.currency,
    session?.amount_total === item?.amount,
    line?.length === 1,
    line?.[0]?.quantity === 1,
    price?.id === item?.price,
    productId === item?.product,
    price?.unit_amount === item?.amount,
    price?.currency === item?.currency,
    /^acct_[0-9a-z-]+$/i.test(String(accountId || '')),
    session?.client_reference_id === accountId,
    !expected.accountId || accountId === expected.accountId,
    /^sub_[0-9a-z_]+$/i.test(String(subscriptionId || '')),
    typeof subscription === 'object',
    subscription?.status === 'active',
    subscription?.metadata?.spydergoat_account_id === accountId,
    subscription?.metadata?.spydergoat_sku === sku,
    Number.isSafeInteger(subscription?.current_period_start),
    Number.isSafeInteger(subscription?.current_period_end),
    subscription?.current_period_end > subscription?.current_period_start,
  ];
  return checks.every(Boolean)
    ? {
      ok: true, sku, accountId, customerId: session.customer, item, subscriptionId,
      periodStart: subscription.current_period_start, periodEnd: subscription.current_period_end,
    }
    : { ok: false, error: 'Checkout session failed closed validation' };
}

export async function consumePaidRequest(repository, accountId, now) {
  return repository.consumeAllowance(accountId, now);
}

function requiredEventCreated(event) {
  if (!Number.isSafeInteger(event?.created) || event.created < 1) throw new Error('Stripe event.created is required');
  return event.created;
}

function id(value) {
  return typeof value === 'string' ? value : value?.id;
}

function lifecycleCommand(event) {
  const object = event.data?.object;
  const eventCreated = requiredEventCreated(event);
  let metadata;
  let accountId;
  let subscriptionId;
  let customerId;
  let status;
  let periodStart;
  let periodEnd;
  let resetPeriodCalls = false;

  if (event.type.startsWith('customer.subscription.')) {
    metadata = object?.metadata;
    accountId = metadata?.spydergoat_account_id;
    subscriptionId = object?.id;
    customerId = id(object?.customer);
    status = object?.status;
    periodStart = object?.current_period_start;
    periodEnd = object?.current_period_end;
    if (event.type === 'customer.subscription.deleted') {
      if (status !== 'canceled') throw new Error('Deleted subscription is not canceled');
      resetPeriodCalls = false;
    } else {
      const allowed = new Set(['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'paused', 'incomplete', 'incomplete_expired']);
      if (!allowed.has(status)) throw new Error('Unknown subscription status');
      resetPeriodCalls = ['active', 'trialing'].includes(status);
    }
  } else {
    metadata = object?.subscription_details?.metadata;
    accountId = metadata?.spydergoat_account_id;
    subscriptionId = id(object?.subscription);
    customerId = id(object?.customer);
    if (event.type === 'invoice.paid') {
      if (object?.paid !== true || object?.status !== 'paid' || object?.billing_reason !== 'subscription_cycle') {
        throw new Error('Invoice is not an authenticated paid renewal');
      }
      const lines = object?.lines?.data?.filter(line => line?.type === 'subscription' && id(line?.subscription) === subscriptionId);
      if (lines?.length !== 1) throw new Error('Invoice subscription period is invalid');
      periodStart = lines[0]?.period?.start;
      periodEnd = lines[0]?.period?.end;
      status = 'active';
      resetPeriodCalls = true;
    } else {
      if (object?.paid !== false) throw new Error('Failed invoice payment state is invalid');
      status = 'past_due';
    }
  }

  if (
    metadata?.spydergoat_sku !== 'subscription'
    || !/^acct_[0-9a-z-]+$/i.test(String(accountId || ''))
    || !/^sub_[0-9a-z_]+$/i.test(String(subscriptionId || ''))
    || !/^cus_[0-9a-z_]+$/i.test(String(customerId || ''))
  ) throw new Error('Stripe lifecycle account binding is invalid');
  if (resetPeriodCalls && (
    !Number.isSafeInteger(periodStart) || !Number.isSafeInteger(periodEnd) || periodEnd <= periodStart
  )) throw new Error('Stripe subscription period is invalid');

  return {
    kind: 'lifecycle', type: event.type, accountId, customerId, subscriptionId, status,
    eventCreated, periodStart, periodEnd, resetPeriodCalls,
  };
}

export async function processStripeEvent(repository, event, catalog, options = {}) {
  const supported = new Set([
    'checkout.session.completed', 'invoice.paid', 'invoice.payment_failed',
    'customer.subscription.updated', 'customer.subscription.deleted',
  ]);
  if (!supported.has(event?.type)) return { ignored: true };
  if (!event.id) throw new Error('Stripe event ID is required');
  if (typeof options.livemode !== 'boolean' || event.livemode !== options.livemode) {
    throw new Error('Stripe event livemode does not match configuration');
  }
  const eventCreated = requiredEventCreated(event);

  if (event.type !== 'checkout.session.completed') {
    const command = lifecycleCommand(event);
    if (repository.hasLifecycleAuthority && !await repository.hasLifecycleAuthority(command)) {
      throw new Error('Stripe lifecycle account authority was not established');
    }
    const result = await repository.applyStripeEventOnce(event.id, command);
    options.logger?.info?.('stripe_event_processed', { eventId: event.id, type: event.type, replayed: result.replayed, stale: result.stale });
    return result;
  }

  if (await repository.hasStripeEvent?.(event.id)) return { replayed: true };

  const session = event.data?.object;
  const accountId = session?.metadata?.spydergoat_account_id;
  if (!accountId) throw new Error('Deterministic account binding is required');
  const validation = validateCheckoutSession(session, catalog, { livemode: options.livemode, accountId });
  if (!validation.ok) throw new Error(validation.error);
  if (repository.hasPendingAccount && !await repository.hasPendingAccount(accountId)) {
    throw new Error('Checkout account authority was not established');
  }

  const ttl = options.deliveryTtlSeconds ?? DEFAULT_DELIVERY_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_DELIVERY_TTL_SECONDS) {
    throw new Error('API key delivery expiry must be between 1 and 900 seconds');
  }
  if (!session?.id) throw new Error('Checkout Session ID is required');
  const now = (options.now || (() => Math.floor(Date.now() / 1000)))();
  const rawKey = generateApiKey(options.fillRandom);
  const delivery = await encryptApiKeyDelivery(rawKey, {
    secret: options.deliverySecret,
    accountId,
    checkoutSessionId: session.id,
    expiresAt: now + ttl,
  });
  const command = {
    kind: 'provision',
    accountId,
    customerId: validation.customerId,
    subscriptionId: validation.subscriptionId,
    checkoutSessionId: session.id,
    eventCreated,
    periodStart: validation.periodStart,
    periodEnd: validation.periodEnd,
    credentialId: `cred_${crypto.randomUUID()}`,
    keyDigest: await hashApiKey(rawKey),
    displaySuffix: rawKey.slice(-8),
    encryptedKey: delivery.encryptedKey,
    iv: delivery.iv,
    deliveryExpiresAt: delivery.expiresAt,
  };
  const result = await repository.applyStripeEventOnce(event.id, command);
  options.logger?.info?.('stripe_event_processed', { eventId: event.id, type: event.type, replayed: Boolean(result.replayed) });
  return result;
}
