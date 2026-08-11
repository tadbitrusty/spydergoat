function d1Blob(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new Error('D1 BLOB value is invalid');
}

function fromD1Blob(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value);
  }
  throw new Error('D1 returned an invalid BLOB value');
}

export class D1BillingRepository {
  constructor(db) {
    if (!db) throw new Error('D1 billing repository is not configured');
    this.db = db;
  }

  async createPendingAccount(accountId) {
    const result = await this.db.prepare(`
      INSERT INTO accounts (id, subscription_status, created_at, updated_at)
      VALUES (?1, 'pending', unixepoch(), unixepoch())
      ON CONFLICT(id) DO NOTHING
    `).bind(accountId).run();
    if (!result?.success || Number(result?.meta?.changes || 0) !== 1) {
      throw new Error('Pending billing account was not created');
    }
  }

  async markCheckoutFailed(accountId) {
    const result = await this.db.prepare(`
      UPDATE accounts
      SET subscription_status = 'checkout_failed', updated_at = unixepoch()
      WHERE id = ?1 AND subscription_status = 'pending'
    `).bind(accountId).run();
    if (!result?.success || Number(result?.meta?.changes || 0) !== 1) {
      throw new Error('Pending billing account failure was not recorded');
    }
  }

  async requirePendingAccount(accountId) {
    const row = await this.db.prepare(`
      SELECT id FROM accounts
      WHERE id = ?1 AND subscription_status = 'pending'
      LIMIT 1
    `).bind(accountId).first();
    if (row?.id !== accountId) throw new Error('Checkout account binding is not pending');
  }

  async findAccountByKeyDigest(digest, now) {
    return this.db.prepare(`
      SELECT accounts.id, accounts.subscription_status = 'active' AS active
      FROM api_credentials
      JOIN accounts ON accounts.id = api_credentials.account_id
      WHERE api_credentials.key_digest = ?1
        AND api_credentials.revoked_at IS NULL
        AND accounts.subscription_status = 'active'
        AND accounts.period_start IS NOT NULL AND accounts.period_end IS NOT NULL
        AND ?2 >= accounts.period_start AND ?2 < accounts.period_end
      LIMIT 1
    `).bind(digest, now).first();
  }

  async consumeAllowance(accountId, now) {
    const row = await this.db.prepare(`
      UPDATE accounts
      SET current_period_calls = current_period_calls + 1,
          updated_at = unixepoch()
      WHERE id = ?1
        AND subscription_status = 'active'
        AND period_start IS NOT NULL AND period_end IS NOT NULL
        AND ?2 >= period_start AND ?2 < period_end
        AND current_period_calls < 5000
      RETURNING current_period_calls, wallet_balance
    `).bind(accountId, now).first();
    if (!row) return { allowed: false, reason: 'inactive_outside_period_or_exhausted' };
    return {
      allowed: true,
      tier: 'paid',
      calls: row.current_period_calls,
      wallet: row.wallet_balance,
    };
  }

  async hasStripeEvent(eventId) {
    const row = await this.db.prepare("SELECT status FROM stripe_events WHERE event_id = ?1 AND status = 'processed' LIMIT 1")
      .bind(eventId).first();
    return Boolean(row);
  }

  async hasPendingAccount(accountId) {
    const row = await this.db.prepare("SELECT 1 AS pending FROM accounts WHERE id = ?1 AND subscription_status = 'pending' LIMIT 1")
      .bind(accountId).first();
    return Boolean(row);
  }

  async hasLifecycleAuthority(command) {
    const row = await this.db.prepare(`SELECT 1 AS authoritative FROM accounts
      WHERE id = ?1 AND stripe_customer_id = ?2 AND stripe_subscription_id = ?3 LIMIT 1`)
      .bind(command.accountId, command.customerId, command.subscriptionId).first();
    return Boolean(row);
  }

  async applyStripeEventOnce(eventId, command) {
    if (!this.db.batch) throw new Error('Transactional D1 batch support is required');
    const claim = crypto.randomUUID();
    const receivedAt = Math.floor(Date.now() / 1000);
    const eventCreated = command.eventCreated;
    const eventType = command.type || (command.kind === 'provision' ? 'checkout.session.completed' : command.kind);
    const statements = [
      this.db.prepare(`INSERT OR IGNORE INTO stripe_events
        (event_id, claim_token, event_type, status, event_created, created_at)
        VALUES (?1, ?2, ?3, 'processing', ?4, ?5)`).bind(eventId, claim, eventType, eventCreated, receivedAt),
    ];

    if (command.kind === 'credit') {
      statements.push(this.db.prepare(`UPDATE accounts SET wallet_balance = wallet_balance + ?1, updated_at = ?2
        WHERE id = ?3 AND EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?4 AND claim_token = ?5 AND status = 'processing')`)
        .bind(command.credits, receivedAt, command.accountId, eventId, claim));
      statements.push(this.db.prepare(`INSERT INTO wallet_ledger (stripe_event_id, account_id, credit_delta, created_at)
        SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?1 AND claim_token = ?5 AND status = 'processing')`)
        .bind(eventId, command.accountId, command.credits, receivedAt, claim));
    } else if (command.kind === 'provision') {
      statements.push(this.db.prepare(`UPDATE accounts
        SET stripe_customer_id = ?1, stripe_subscription_id = ?2, subscription_status = 'active',
            period_start = ?3, period_end = ?4, last_stripe_event_created = ?5,
            last_stripe_event_id = ?6, updated_at = ?7
        WHERE id = ?8 AND subscription_status = 'pending'
          AND last_stripe_event_created < ?5
          AND EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?6 AND claim_token = ?9 AND status = 'processing')`)
        .bind(command.customerId, command.subscriptionId, command.periodStart, command.periodEnd,
          eventCreated, eventId, receivedAt, command.accountId, claim));
      statements.push(this.db.prepare(`INSERT INTO api_credentials
        (id, account_id, checkout_session_id, key_digest, display_suffix, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6
        WHERE EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?7 AND claim_token = ?8 AND status = 'processing')
          AND EXISTS (SELECT 1 FROM accounts WHERE id = ?2 AND stripe_subscription_id = ?9 AND last_stripe_event_created = ?10)`)
        .bind(command.credentialId, command.accountId, command.checkoutSessionId, command.keyDigest,
          command.displaySuffix, receivedAt, eventId, claim, command.subscriptionId, eventCreated));
      statements.push(this.db.prepare(`INSERT INTO key_deliveries
        (checkout_session_id, account_id, encrypted_key, iv, expires_at, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6
        WHERE EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?7 AND claim_token = ?8 AND status = 'processing')
          AND EXISTS (SELECT 1 FROM api_credentials WHERE checkout_session_id = ?1 AND key_digest = ?9)`)
        .bind(command.checkoutSessionId, command.accountId, d1Blob(command.encryptedKey), d1Blob(command.iv),
          command.deliveryExpiresAt, receivedAt, eventId, claim, command.keyDigest));
    } else if (command.kind === 'lifecycle') {
      statements.push(this.db.prepare(`UPDATE accounts
        SET subscription_status = CASE
              WHEN last_stripe_event_created = ?5 AND last_stripe_event_id <> ?6 THEN 'event_conflict'
              WHEN ?12 = 1 AND subscription_status = 'active' THEN 'active'
              ELSE ?1
            END,
            current_period_calls = CASE WHEN ?2 = 1 AND ?3 > COALESCE(period_start, -1)
              AND ?5 > last_stripe_event_created THEN 0 ELSE current_period_calls END,
            period_start = CASE WHEN ?2 = 1 AND ?3 > COALESCE(period_start, -1)
              AND ?5 > last_stripe_event_created THEN ?3 ELSE period_start END,
            period_end = CASE WHEN ?2 = 1 AND ?3 > COALESCE(period_start, -1)
              AND ?5 > last_stripe_event_created THEN ?4 ELSE period_end END,
            last_stripe_event_created = CASE WHEN ?5 > last_stripe_event_created THEN ?5 ELSE last_stripe_event_created END,
            last_stripe_event_id = ?6, updated_at = ?7
        WHERE id = ?8 AND stripe_customer_id = ?9 AND stripe_subscription_id = ?10
          AND (?5 > last_stripe_event_created OR (?5 = last_stripe_event_created AND ?6 <> last_stripe_event_id))
          AND EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?6 AND claim_token = ?11 AND status = 'processing')`)
        .bind(command.status, command.resetPeriodCalls ? 1 : 0, command.periodStart ?? null, command.periodEnd ?? null,
          eventCreated, eventId, receivedAt, command.accountId, command.customerId, command.subscriptionId, claim,
          command.preserveActiveUntilPeriodEnd ? 1 : 0));
    } else {
      throw new Error('Unknown Stripe event command');
    }

    if (command.kind === 'provision') {
      statements.push(this.db.prepare(`UPDATE stripe_events
        SET status = 'processed', processed_at = ?1, checkout_session_id = ?4, delivery_session_id = ?4
        WHERE event_id = ?2 AND claim_token = ?3 AND status = 'processing'`)
        .bind(receivedAt, eventId, claim, command.checkoutSessionId));
    } else {
      statements.push(this.db.prepare(`UPDATE stripe_events SET status = 'processed', processed_at = ?1
        WHERE event_id = ?2 AND claim_token = ?3 AND status = 'processing'`).bind(receivedAt, eventId, claim));
    }
    const results = await this.db.batch(statements);
    const claimed = Number(results?.[0]?.meta?.changes || 0) === 1;
    const stateChanged = Number(results?.[1]?.meta?.changes || 0) === 1;
    if (claimed && command.kind === 'provision' && !stateChanged) {
      throw new Error('Checkout account authority was not established');
    }
    return { replayed: !claimed, stale: claimed && command.kind === 'lifecycle' && !stateChanged };
  }

  async readKeyDelivery(checkoutSessionId, accountId, now) {
    const row = await this.db.prepare(`
      SELECT encrypted_key, iv, expires_at
      FROM key_deliveries
      WHERE checkout_session_id = ?2
        AND account_id = ?3
        AND consumed_at IS NULL
        AND expires_at > ?1
    `).bind(now, checkoutSessionId, accountId).first();
    if (!row) return null;
    return { encryptedKey: fromD1Blob(row.encrypted_key), iv: fromD1Blob(row.iv), expiresAt: row.expires_at };
  }

  async consumeKeyDeliveryOnce(checkoutSessionId, accountId, now) {
    const row = await this.db.prepare(`
      UPDATE key_deliveries
      SET consumed_at = ?1
      WHERE checkout_session_id = ?2
        AND account_id = ?3
        AND consumed_at IS NULL
        AND expires_at > ?1
      RETURNING checkout_session_id
    `).bind(now, checkoutSessionId, accountId).first();
    return Boolean(row);
  }
}
