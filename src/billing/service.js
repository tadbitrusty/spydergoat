const encoder = new TextEncoder();

function hex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashApiKey(rawKey) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(rawKey))));
}

export async function authenticateApiKey(repository, rawKey) {
  if (!/^sg_[0-9a-f]{48}$/i.test(String(rawKey || ''))) throw new Error('Invalid API key');
  const digest = await hashApiKey(rawKey);
  const account = await repository.findAccountByKeyDigest(digest);
  if (!account || !Boolean(account.active)) throw new Error('Invalid API key');
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
  if (!event.id) throw new Error('Stripe event ID is required');
  if (event.type === 'customer.subscription.deleted' || event.type === 'charge.refunded') {
    const object = event.data?.object;
    const customerId = typeof object?.customer === 'string' ? object.customer : object?.customer?.id;
    if (!customerId) throw new Error('Stripe customer binding is required for revocation');
    return repository.applyStripeEventOnce(event.id, { kind: 'revoke', customerId, eventType: event.type });
  }
  if (event.type === 'invoice.payment_failed'
      || (event.type === 'customer.subscription.updated' && event.data?.object?.status === 'past_due')) {
    const object = event.data?.object;
    const customerId = typeof object?.customer === 'string' ? object.customer : object?.customer?.id;
    if (!customerId) throw new Error('Stripe customer binding is required for grace period');
    const graceDays = Number.isInteger(options.graceDays) && options.graceDays > 0 ? options.graceDays : 7;
    return repository.applyStripeEventOnce(event.id, {
      kind: 'past_due', customerId, graceUntil: Math.floor((options.now?.() || Date.now()) / 1000) + graceDays * 86_400,
      eventType: event.type,
    });
  }
  if (event.type === 'invoice.paid') {
    const invoice = event.data?.object;
    const customerId = typeof invoice?.customer === 'string' ? invoice.customer : invoice?.customer?.id;
    if (!customerId) throw new Error('Stripe customer binding is required for renewal');
    return repository.applyStripeEventOnce(event.id, {
      kind: 'renew', customerId,
      periodStart: invoice.period_start || null, periodEnd: invoice.period_end || null,
    });
  }
  if (event?.type !== 'checkout.session.completed') return { ignored: true };
  const webhookSession = event.data?.object;
  if (!webhookSession?.id) throw new Error('Checkout Session ID is required');
  if (!options.retrieveCheckoutSession) throw new Error('Expanded Checkout Session retrieval is required');
  const session = await options.retrieveCheckoutSession(webhookSession.id);
  if (session?.id !== webhookSession.id) throw new Error('Retrieved Checkout Session did not match the webhook');
  const accountId = session?.metadata?.spydergoat_account_id;
  if (!accountId) throw new Error('Deterministic account binding is required');
  const validation = validateCheckoutSession(session, catalog, { livemode: options.livemode, accountId });
  if (!validation.ok) throw new Error(validation.error);

  const credential = validation.item.mode === 'subscription' ? await options.issueCredential?.(session) : undefined;
  if (validation.item.mode === 'subscription' && !credential) throw new Error('Credential issuance is not configured');
  const command = validation.item.mode === 'subscription'
    ? {
        kind: 'provision', accountId, customerId: validation.customerId,
        subscriptionId: session.subscription, checkoutSessionId: session.id, credential,
      }
    : { kind: 'credit', accountId, customerId: validation.customerId, credits: validation.item.credits };
  const result = await repository.applyStripeEventOnce(event.id, command);
  options.logger?.info?.('stripe_event_processed', { eventId: event.id, type: event.type, replayed: Boolean(result.replayed) });
  return result;
}

export async function findPaidUnprovisionedSessions(repository, sessions, catalog, options = {}) {
  const missing = [];
  for (const session of sessions) {
    if (session?.payment_status !== 'paid') continue;
    const validation = validateCheckoutSession(session, catalog, { livemode: options.livemode });
    if (!validation.ok) continue;
    if (!await repository.hasProvisionedCheckoutSession(session.id)) missing.push(session.id);
  }
  return missing;
}
