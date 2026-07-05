export type FieldType = 'text' | 'url' | 'email' | 'select';

export interface ConnectorField {
  key: string;
  label: string;
  type: FieldType;
  /** Secret fields are write-only: the API accepts them but never returns the value. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  options?: string[];
  help?: string;
}

export interface ConnectorDef {
  key: string;
  label: string;
  description: string;
  fields: ConnectorField[];
}

export const CONNECTORS: ConnectorDef[] = [
  {
    key: 'slack',
    label: 'Slack',
    description: 'Post a message to a Slack channel via an incoming webhook.',
    fields: [
      {
        key: 'webhook_url',
        label: 'Slack Incoming Webhook URL',
        type: 'url',
        secret: true,
        required: true,
        placeholder: 'https://hooks.slack.com/services/...',
      },
    ],
  },
  {
    key: 'discord',
    label: 'Discord',
    description: 'Post a message to a Discord channel via a webhook.',
    fields: [
      {
        key: 'webhook_url',
        label: 'Discord Webhook URL',
        type: 'url',
        secret: true,
        required: true,
        placeholder: 'https://discord.com/api/webhooks/...',
      },
    ],
  },
  {
    key: 'email',
    label: 'Email',
    description: 'Email each submission through Resend or your own SMTP server.',
    fields: [
      {
        key: 'provider',
        label: 'Provider',
        type: 'select',
        secret: false,
        required: true,
        options: ['resend', 'smtp'],
      },
      {
        key: 'resend_api_key',
        label: 'Resend API Key',
        type: 'text',
        secret: true,
        required: false,
        placeholder: 're_...',
        help: 'Required when provider is Resend.',
      },
      {
        key: 'smtp_url',
        label: 'SMTP URL',
        type: 'text',
        secret: true,
        required: false,
        placeholder: 'smtp://user:pass@smtp.host.com:587',
        help: 'Required when provider is SMTP.',
      },
      {
        key: 'from',
        label: 'From address',
        type: 'email',
        secret: false,
        required: true,
        placeholder: 'forms@yourdomain.com',
      },
      {
        key: 'to',
        label: 'To address',
        type: 'email',
        secret: false,
        required: true,
        placeholder: 'you@yourdomain.com',
      },
    ],
  },
  {
    key: 'zapier',
    label: 'Zapier',
    description:
      'POST each submission to a Zapier Catch Hook to trigger any Zap.',
    fields: [
      {
        key: 'hook_url',
        label: 'Catch Hook URL',
        type: 'url',
        secret: true,
        required: true,
        placeholder: 'https://hooks.zapier.com/hooks/catch/...',
        help: 'Create a "Webhooks by Zapier → Catch Hook" trigger and paste its URL.',
      },
    ],
  },
];

const BY_KEY = new Map(CONNECTORS.map((c) => [c.key, c]));

export function getConnector(key: string): ConnectorDef | undefined {
  return BY_KEY.get(key);
}

export function isKnownConnector(key: string): boolean {
  return BY_KEY.has(key);
}

export function isSecretField(connectorKey: string, fieldKey: string): boolean {
  const field = BY_KEY.get(connectorKey)?.fields.find((f) => f.key === fieldKey);
  return field?.secret ?? false;
}

export function isKnownField(connectorKey: string, fieldKey: string): boolean {
  return !!BY_KEY.get(connectorKey)?.fields.find((f) => f.key === fieldKey);
}

/**
 * Returns the list of missing required field keys for a connector given the set
 * of field keys that currently hold a value. Encodes the conditional email rules.
 */
export function missingRequiredFields(
  connectorKey: string,
  presentKeys: Set<string>,
  values?: Record<string, string>
): string[] {
  const def = BY_KEY.get(connectorKey);
  if (!def) return [];
  const missing: string[] = [];

  for (const field of def.fields) {
    if (field.required && !presentKeys.has(field.key)) {
      missing.push(field.key);
    }
  }

  if (connectorKey === 'email') {
    const provider = values?.provider;
    if (provider === 'resend' && !presentKeys.has('resend_api_key')) {
      missing.push('resend_api_key');
    }
    if (provider === 'smtp' && !presentKeys.has('smtp_url')) {
      missing.push('smtp_url');
    }
  }

  return missing;
}
