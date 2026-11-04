export type ConnectorState = 'connected' | 'not_configured' | 'error';

export type ConnectorKind =
  | 'email'
  | 'calendar'
  | 'slack'
  | 'payments'
  | 'notion'
  | 'brain'
  | 'social'
  | 'crm'
  | 'ads'
  | 'analytics'
  | 'creative'
  | 'knowledge'
  | 'local'
  | 'orchestration';

/**
 * One thing a connector can actually DO, with its own state. A connector is
 * not simply "connected": WhatsApp reads from the local desktop app while
 * being unable to send at all, and reporting a single green state for that
 * claims a capability the user does not have.
 */
export type ConnectorCapability = {
  id: string;
  label: string;
  state: ConnectorState;
  detail: string;
  /** Where to go to set this specific capability up. */
  setupHref?: string;
};

export type ConnectorStatus = {
  id: string;
  name: string;
  kind: ConnectorKind;
  state: ConnectorState;
  detail: string;
  meta?: Record<string, string | number>;
  /** Per-capability breakdown, when one green dot would be misleading. */
  capabilities?: ConnectorCapability[];
  /** A deeper configuration surface, when the connector has real choices. */
  configHref?: string;
};
