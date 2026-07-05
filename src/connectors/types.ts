export interface DispatchSubmission {
  formId: string;
  submissionId: string | null;
  submittedAt: string | null;
  eventType: string;
  /** Field values keyed by human-readable name (via field_mapping). */
  data: Record<string, unknown>;
  /** Field values keyed by raw field id. */
  raw: Record<string, unknown>;
}

export type Connector = (
  values: Record<string, string>,
  submission: DispatchSubmission
) => Promise<void>;
