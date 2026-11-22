export class D1BillingRepository {
  constructor(db) {
    if (!db) throw new Error('D1 billing repository is not configured');
    this.db = db;
  }

  async findAccountByKeyDigest(digest) {
    return this.db.prepare(`
      SELECT accounts.id,
        (accounts.subscription_status = 'active'
          OR (accounts.subscription_status = 'past_due' AND accounts.grace_until > unixepoch())) AS active
      FROM api_credentials
      JOIN accounts ON accounts.id = api_credentials.account_id
      WHERE api_credentials.key_digest = ?1
        AND api_credentials.revoked_at IS NULL
      LIMIT 1
    `).bind(digest).first();
  }

  async consumeAllowance(accountId) {
    const row = await this.db.prepare(`
      UPDATE accounts
      SET current_period_calls = current_period_calls + 1,
          updated_at = unixepoch()
      WHERE id = ?1
        AND (subscription_status = 'active'
          OR (subscription_status = 'past_due' AND grace_until > unixepoch()))
        AND current_period_calls < 5000
      RETURNING current_period_calls, wallet_balance
    `).bind(accountId).first();
    if (!row) return { allowed: false, reason: 'inactive_or_empty' };
    return {
      allowed: true,
      tier: 'paid',
      calls: row.current_period_calls,
      wallet: row.wallet_balance,
    };
  }

  async applyStripeEventOnce(eventId, command) {
    if (!this.db.batch) throw new Error('Transactional D1 batch support is required');
    const claim = crypto.randomUUID();
    const created = Math.floor(Date.now() / 1000);
    const statements = [
      this.db.prepare(`INSERT OR IGNORE INTO stripe_events (event_id, claim_token, event_type, status, created_at)
        VALUES (?1, ?2, ?3, 'processing', ?4)`).bind(eventId, claim, command.kind, created),
    ];
    if (command.kind === 'credit') {
      statements.push(this.db.prepare(`UPDATE accounts SET wallet_balance = wallet_balance + ?1, updated_at = ?2
        WHERE id = ?3 AND EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?4 AND claim_token = ?5 AND status = 'processing')`)
        .bind(command.credits, created, command.accountId, eventId, claim));
      statements.push(this.db.prepare(`INSERT INTO wallet_ledger (stripe_event_id, account_id, credit_delta, created_at)
        SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?1 AND claim_token = ?5 AND status = 'processing')`)
        .bind(eventId, command.accountId, command.credits, created, claim));
    } else if (command.kind === 'provision') {
      statements.push(this.db.prepare(`INSERT INTO accounts (id, stripe_customer_id, subscription_status, created_at, updated_at)
        SELECT ?1, ?2, 'active', ?3, ?3
        WHERE EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?4 AND claim_token = ?5 AND status = 'processing')
        ON CONFLICT(id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id,
          subscription_status = 'active', updated_at = excluded.updated_at`)
        .bind(command.accountId, command.customerId, created, eventId, claim));
      statements.push(this.db.prepare(`UPDATE accounts SET stripe_subscription_id = ?1
        WHERE id = ?2 AND EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?3 AND claim_token = ?4 AND status = 'processing')`)
        .bind(command.subscriptionId, command.accountId, eventId, claim));
      statements.push(this.db.prepare(`INSERT INTO api_credentials (id, account_id, key_digest, display_suffix, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS
          (SELECT 1 FROM stripe_events WHERE event_id = ?6 AND claim_token = ?7 AND status = 'processing')`)
        .bind(command.credential.id, command.accountId, command.credential.digest, command.credential.suffix, created, eventId, claim));
      statements.push(this.db.prepare(`INSERT INTO key_deliveries
        (checkout_session_id, account_id, encrypted_key, iv, nonce_digest, expires_at, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE EXISTS
          (SELECT 1 FROM stripe_events WHERE event_id = ?8 AND claim_token = ?9 AND status = 'processing')`)
        .bind(command.checkoutSessionId, command.accountId, command.credential.encryptedKey,
          command.credential.iv, command.credential.nonceDigest, created + 3600, created, eventId, claim));
    } else if (command.kind === 'past_due') {
      statements.push(this.db.prepare(`UPDATE accounts
        SET subscription_status = 'past_due', grace_until = COALESCE(grace_until, ?1), updated_at = ?2
        WHERE stripe_customer_id = ?3 AND EXISTS
          (SELECT 1 FROM stripe_events WHERE event_id = ?4 AND claim_token = ?5 AND status = 'processing')`)
        .bind(command.graceUntil, created, command.customerId, eventId, claim));
    } else if (command.kind === 'renew') {
      statements.push(this.db.prepare(`UPDATE accounts
        SET subscription_status = 'active', grace_until = NULL, current_period_calls = 0,
          period_start = ?1, period_end = ?2, updated_at = ?3
        WHERE stripe_customer_id = ?4 AND EXISTS
          (SELECT 1 FROM stripe_events WHERE event_id = ?5 AND claim_token = ?6 AND status = 'processing')`)
        .bind(command.periodStart, command.periodEnd, created, command.customerId, eventId, claim));
    } else if (command.kind === 'revoke') {
      statements.push(this.db.prepare(`UPDATE accounts SET subscription_status = 'revoked', updated_at = ?1
        WHERE stripe_customer_id = ?2 AND EXISTS
          (SELECT 1 FROM stripe_events WHERE event_id = ?3 AND claim_token = ?4 AND status = 'processing')`)
        .bind(created, command.customerId, eventId, claim));
      statements.push(this.db.prepare(`UPDATE api_credentials SET revoked_at = ?1
        WHERE account_id IN (SELECT id FROM accounts WHERE stripe_customer_id = ?2)
          AND revoked_at IS NULL AND EXISTS
          (SELECT 1 FROM stripe_events WHERE event_id = ?3 AND claim_token = ?4 AND status = 'processing')`)
        .bind(created, command.customerId, eventId, claim));
    }
    statements.push(this.db.prepare(`UPDATE stripe_events SET status = 'processed', processed_at = ?1
      WHERE event_id = ?2 AND claim_token = ?3 AND status = 'processing'`).bind(created, eventId, claim));
    const results = await this.db.batch(statements);
    const claimed = Number(results?.[0]?.meta?.changes || 0) === 1;
    return { replayed: !claimed };
  }

  async consumeKeyDelivery(checkoutSessionId) {
    return this.db.prepare(`UPDATE key_deliveries SET consumed_at = unixepoch()
      WHERE checkout_session_id = ?1 AND consumed_at IS NULL AND expires_at > unixepoch()
      RETURNING encrypted_key, iv`).bind(checkoutSessionId).first();
  }

  async hasProvisionedCheckoutSession(checkoutSessionId) {
    const row = await this.db.prepare(`SELECT 1 AS provisioned FROM key_deliveries
      WHERE checkout_session_id = ?1 LIMIT 1`).bind(checkoutSessionId).first();
    return Boolean(row?.provisioned);
  }

  async replaceCredentialForCheckout(command) {
    const created = Math.floor(Date.now() / 1000);
    const results = await this.db.batch([
      this.db.prepare(`UPDATE api_credentials SET revoked_at = ?1
        WHERE account_id = ?2 AND revoked_at IS NULL`).bind(created, command.accountId),
      this.db.prepare('DELETE FROM key_deliveries WHERE checkout_session_id = ?1').bind(command.checkoutSessionId),
      this.db.prepare(`INSERT INTO api_credentials (id, account_id, key_digest, display_suffix, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`).bind(command.credential.id, command.accountId,
        command.credential.digest, command.credential.suffix, created),
      this.db.prepare(`INSERT INTO key_deliveries
        (checkout_session_id, account_id, encrypted_key, iv, nonce_digest, expires_at, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(command.checkoutSessionId, command.accountId,
        command.credential.encryptedKey, command.credential.iv, command.credential.nonceDigest,
        created + 3600, created),
    ]);
    if (results.some(result => result?.success === false)) throw new Error('Key resend transaction failed');
  }

  async revokeExpiredGrace(nowSeconds = Math.floor(Date.now() / 1000)) {
    const results = await this.db.batch([
      this.db.prepare(`UPDATE api_credentials SET revoked_at = ?1
        WHERE revoked_at IS NULL AND account_id IN
          (SELECT id FROM accounts WHERE subscription_status = 'past_due' AND grace_until <= ?1)`).bind(nowSeconds),
      this.db.prepare(`UPDATE accounts SET subscription_status = 'revoked', updated_at = ?1
        WHERE subscription_status = 'past_due' AND grace_until <= ?1`).bind(nowSeconds),
    ]);
    return Number(results?.[1]?.meta?.changes || 0);
  }
}
