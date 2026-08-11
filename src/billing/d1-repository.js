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
    if (!result?.success) throw new Error('Pending billing account was not created');
  }

  async markCheckoutFailed(accountId) {
    const result = await this.db.prepare(`
      UPDATE accounts
      SET subscription_status = 'checkout_failed', updated_at = unixepoch()
      WHERE id = ?1 AND subscription_status = 'pending'
    `).bind(accountId).run();
    if (!result?.success) throw new Error('Pending billing account failure was not recorded');
  }

  async findAccountByKeyDigest(digest) {
    return this.db.prepare(`
      SELECT accounts.id, accounts.subscription_status = 'active' AS active
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
          wallet_balance = wallet_balance -
            CASE WHEN current_period_calls >= 5000 THEN 1 ELSE 0 END,
          updated_at = unixepoch()
      WHERE id = ?1
        AND subscription_status = 'active'
        AND (current_period_calls < 5000 OR wallet_balance >= 1)
      RETURNING current_period_calls, wallet_balance
    `).bind(accountId).first();
    if (!row) return { allowed: false, reason: 'inactive_or_empty' };
    return {
      allowed: true,
      tier: row.current_period_calls <= 5000 ? 'paid' : 'wallet',
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
    } else {
      statements.push(this.db.prepare(`INSERT INTO accounts (id, stripe_customer_id, subscription_status, created_at, updated_at)
        SELECT ?1, ?2, 'active', ?3, ?3
        WHERE EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?4 AND claim_token = ?5 AND status = 'processing')
        ON CONFLICT(id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id,
          subscription_status = 'active', updated_at = excluded.updated_at`)
        .bind(command.accountId, command.customerId, created, eventId, claim));
    }
    statements.push(this.db.prepare(`UPDATE stripe_events SET status = 'processed', processed_at = ?1
      WHERE event_id = ?2 AND claim_token = ?3 AND status = 'processing'`).bind(created, eventId, claim));
    const results = await this.db.batch(statements);
    const claimed = Number(results?.[0]?.meta?.changes || 0) === 1;
    return { replayed: !claimed };
  }
}
