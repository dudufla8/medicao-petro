import { neon } from '@neondatabase/serverless';

export type SqlClient = ReturnType<typeof neon>;

let cachedSql: SqlClient | null = null;
let schemaInitialized = false;

export function getSql(): SqlClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Variável de ambiente DATABASE_URL não configurada.');
  }
  if (!cachedSql) {
    cachedSql = neon(url);
  }
  return cachedSql;
}

/**
 * Inicializa as tabelas de forma idempotente na primeira execução da instância serverless.
 */
export async function ensureSchema(sqlClient?: SqlClient): Promise<void> {
  if (schemaInitialized) return;
  const sql = sqlClient || getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id SERIAL PRIMARY KEY,
      payload_hash VARCHAR(64) UNIQUE NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      type VARCHAR(32) NOT NULL,
      code VARCHAR(64) NOT NULL DEFAULT '',
      status INTEGER,
      booking_id VARCHAR(64) NOT NULL DEFAULT '',
      external_authorization_id VARCHAR(128) NOT NULL DEFAULT '',
      api_version VARCHAR(32) NOT NULL DEFAULT '',
      has_driver_comment BOOLEAN NOT NULL DEFAULT FALSE,
      payload JSONB,
      payload_purged_at TIMESTAMPTZ
    );
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events (received_at DESC);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_webhook_events_booking_id ON webhook_events (booking_id);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ride_final_data (
      booking_id VARCHAR(64) PRIMARY KEY,
      ride_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      service_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      stopped_time_seconds INTEGER NOT NULL DEFAULT 0,
      stopped_time_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      toll_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      parking_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      km NUMERIC(12,3) NOT NULL DEFAULT 0,
      time_in_seconds INTEGER NOT NULL DEFAULT 0,
      driver_comment TEXT NOT NULL DEFAULT '',
      category_id VARCHAR(32) NOT NULL DEFAULT '',
      source VARCHAR(16) NOT NULL DEFAULT 'webhook',
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  /**
   * Cache de corridas (TTL curto de 7 dias, apenas campos operacionais mínimos sem PII sensível como telefone/placa/nome).
   */
  await sql`
    CREATE TABLE IF NOT EXISTS rides (
      booking_id VARCHAR(64) PRIMARY KEY,
      service_id VARCHAR(64) NOT NULL DEFAULT '',
      system VARCHAR(32) NOT NULL DEFAULT 'API_TD',
      status_name VARCHAR(64) NOT NULL DEFAULT '',
      start_date TIMESTAMPTZ,
      origem VARCHAR(255) NOT NULL DEFAULT '',
      destino VARCHAR(255) NOT NULL DEFAULT '',
      km_real NUMERIC(12,3) NOT NULL DEFAULT 0,
      km_estimado NUMERIC(12,3) NOT NULL DEFAULT 0,
      valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      valor_estimado NUMERIC(12,2) NOT NULL DEFAULT 0,
      unidade VARCHAR(128) NOT NULL DEFAULT '',
      diretoria VARCHAR(128) NOT NULL DEFAULT '',
      centro_custo VARCHAR(128) NOT NULL DEFAULT '',
      audit_status VARCHAR(32) NOT NULL DEFAULT 'nova',
      cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS justifications (
      id SERIAL PRIMARY KEY,
      qru VARCHAR(64) NOT NULL DEFAULT '',
      evoucher VARCHAR(64) NOT NULL DEFAULT '',
      unique_key VARCHAR(140) UNIQUE NOT NULL,
      justification_text TEXT NOT NULL DEFAULT '',
      quality_score VARCHAR(16) NOT NULL DEFAULT 'weak',
      audit_status VARCHAR(32) NOT NULL DEFAULT 'justificada',
      pagamento VARCHAR(64) NOT NULL DEFAULT 'LIBERADO PAGAMENTO',
      author VARCHAR(120) NOT NULL DEFAULT 'Operador',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      action VARCHAR(64) NOT NULL,
      target_key VARCHAR(140) NOT NULL DEFAULT '',
      previous_status VARCHAR(32),
      new_status VARCHAR(32),
      previous_text TEXT,
      new_text TEXT,
      operator_name VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip_hash VARCHAR(64) PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_until TIMESTAMPTZ
    );
  `;

  schemaInitialized = true;
}

export function resetSchemaCacheForTests(): void {
  schemaInitialized = false;
}
