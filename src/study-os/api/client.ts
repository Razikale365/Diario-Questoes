export class StudyOsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'StudyOsApiError';
    this.status = status;
    this.code = code;
  }
}

const isErrorPayload = (value: unknown): value is { code: string; message: string } => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
};

export async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const error = isErrorPayload(payload)
      ? payload
      : { code: `http_${response.status}`, message: `Study OS request failed (${response.status})` };
    throw new StudyOsApiError(response.status, error.code, error.message);
  }
  return payload;
}
