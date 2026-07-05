import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SecretBox, newSalt } from './secretbox.js';
import { isSecretField, missingRequiredFields } from './connectors/schema.js';

export interface FieldView {
  isSet: boolean;
  updatedAt: string | null;
  /** Present only for non-secret fields. */
  value?: string;
}

export interface ConnectorView {
  connector: string;
  enabled: boolean;
  complete: boolean;
  missing: string[];
  fields: Record<string, FieldView>;
}

export type FormView = Record<string, ConnectorView>;

interface ConnectorRow {
  form_id: string;
  connector: string;
  enabled: number;
  updated_at: string;
}

interface FieldRow {
  form_id: string;
  connector: string;
  field: string;
  value_enc: string;
  updated_at: string;
}

export class Store {
  private readonly db: Database.Database;
  private readonly box: SecretBox;
  /** True when stored secrets can no longer be decrypted (ADMIN_PASSWORD changed). */
  readonly passwordChanged: boolean;

  constructor(dbPath: string, adminPassword: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();

    const salt = this.loadOrCreateSalt();
    this.box = new SecretBox(adminPassword, salt);
    this.passwordChanged = !this.verifyCanary();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connectors (
        form_id    TEXT NOT NULL,
        connector  TEXT NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (form_id, connector)
      );
      CREATE TABLE IF NOT EXISTS connector_fields (
        form_id    TEXT NOT NULL,
        connector  TEXT NOT NULL,
        field      TEXT NOT NULL,
        value_enc  TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (form_id, connector, field)
      );
    `);
  }

  private loadOrCreateSalt(): Buffer {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('kdf_salt') as { value: string } | undefined;
    if (row) return Buffer.from(row.value, 'base64');
    const salt = newSalt();
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
      .run('kdf_salt', salt.toString('base64'));
    return salt;
  }

  /** Returns false when the canary cannot be decrypted (password changed). */
  private verifyCanary(): boolean {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('canary') as { value: string } | undefined;
    if (!row) {
      this.db
        .prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
        .run('canary', this.box.encrypt('lockform-relay-canary'));
      return true;
    }
    return this.box.decrypt(row.value) === 'lockform-relay-canary';
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  getStructure(formId?: string): Record<string, FormView> {
    const connectorRows = (
      formId
        ? this.db.prepare('SELECT * FROM connectors WHERE form_id = ?').all(formId)
        : this.db.prepare('SELECT * FROM connectors').all()
    ) as ConnectorRow[];

    const fieldRows = (
      formId
        ? this.db.prepare('SELECT * FROM connector_fields WHERE form_id = ?').all(formId)
        : this.db.prepare('SELECT * FROM connector_fields').all()
    ) as FieldRow[];

    const result: Record<string, FormView> = {};

    const ensure = (fid: string, connector: string): ConnectorView => {
      const form = (result[fid] ??= {});
      return (form[connector] ??= {
        connector,
        enabled: false,
        complete: false,
        missing: [],
        fields: {},
      });
    };

    for (const row of connectorRows) {
      const view = ensure(row.form_id, row.connector);
      view.enabled = row.enabled === 1;
    }

    const rawValues: Record<string, Record<string, Record<string, string>>> = {};
    for (const row of fieldRows) {
      const view = ensure(row.form_id, row.connector);
      const secret = isSecretField(row.connector, row.field);
      const decrypted = this.box.decrypt(row.value_enc);
      view.fields[row.field] = {
        isSet: true,
        updatedAt: row.updated_at,
        ...(secret ? {} : { value: decrypted ?? '' }),
      };
      if (decrypted !== null) {
        ((rawValues[row.form_id] ??= {})[row.connector] ??= {})[row.field] = decrypted;
      }
    }

    for (const [fid, form] of Object.entries(result)) {
      for (const [connector, view] of Object.entries(form)) {
        const present = new Set(Object.keys(view.fields));
        const values = rawValues[fid]?.[connector];
        view.missing = missingRequiredFields(connector, present, values);
        view.complete = view.missing.length === 0;
      }
    }

    return result;
  }

  /** Decrypted field values for a connector, for dispatch/testing. */
  getValues(formId: string, connector: string): Record<string, string> {
    const rows = this.db
      .prepare('SELECT field, value_enc FROM connector_fields WHERE form_id = ? AND connector = ?')
      .all(formId, connector) as Pick<FieldRow, 'field' | 'value_enc'>[];
    const values: Record<string, string> = {};
    for (const row of rows) {
      const decrypted = this.box.decrypt(row.value_enc);
      if (decrypted !== null) values[row.field] = decrypted;
    }
    return values;
  }

  isEnabled(formId: string, connector: string): boolean {
    const row = this.db
      .prepare('SELECT enabled FROM connectors WHERE form_id = ? AND connector = ?')
      .get(formId, connector) as { enabled: number } | undefined;
    return row?.enabled === 1;
  }

  enabledConnectors(formId: string): string[] {
    const rows = this.db
      .prepare('SELECT connector FROM connectors WHERE form_id = ? AND enabled = 1')
      .all(formId) as { connector: string }[];
    return rows.map((r) => r.connector);
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Upserts field values for a connector. A field mapped to null is cleared;
   * a field omitted from `fields` is left unchanged. Optionally sets enabled.
   */
  setConnector(
    formId: string,
    connector: string,
    fields: Record<string, string | null>,
    enabled?: boolean
  ): void {
    const now = this.now();
    const tx = this.db.transaction(() => {
      const upsertField = this.db.prepare(
        `INSERT INTO connector_fields (form_id, connector, field, value_enc, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(form_id, connector, field)
         DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`
      );
      const deleteField = this.db.prepare(
        'DELETE FROM connector_fields WHERE form_id = ? AND connector = ? AND field = ?'
      );

      for (const [field, value] of Object.entries(fields)) {
        if (value === null) {
          deleteField.run(formId, connector, field);
        } else {
          upsertField.run(formId, connector, field, this.box.encrypt(value), now);
        }
      }

      const existing = this.db
        .prepare('SELECT enabled FROM connectors WHERE form_id = ? AND connector = ?')
        .get(formId, connector) as { enabled: number } | undefined;
      const nextEnabled = enabled === undefined ? existing?.enabled === 1 : enabled;

      this.db
        .prepare(
          `INSERT INTO connectors (form_id, connector, enabled, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(form_id, connector)
           DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
        )
        .run(formId, connector, nextEnabled ? 1 : 0, now);
    });
    tx();
  }

  deleteConnector(formId: string, connector: string): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM connector_fields WHERE form_id = ? AND connector = ?')
        .run(formId, connector);
      this.db
        .prepare('DELETE FROM connectors WHERE form_id = ? AND connector = ?')
        .run(formId, connector);
    });
    tx();
  }

  deleteForm(formId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM connector_fields WHERE form_id = ?').run(formId);
      this.db.prepare('DELETE FROM connectors WHERE form_id = ?').run(formId);
    });
    tx();
  }
}
