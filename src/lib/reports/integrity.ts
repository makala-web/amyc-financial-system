export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

// Deterministic hash for tamper/corruption detection in offline files.
export function integrityHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

function getSignatureSalt(): string {
  return (
    process.env.NEXT_PUBLIC_REPORT_SIGNATURE_SALT ||
    'AMYC_OFFLINE_DEFAULT_SALT_CHANGE_ME'
  );
}

export function hasWeakReportSignatureSalt(): boolean {
  const salt = getSignatureSalt();
  return !salt || salt === 'AMYC_OFFLINE_DEFAULT_SALT_CHANGE_ME';
}

export function assertStrongReportSignatureSalt(): void {
  if (process.env.NODE_ENV === 'production' && hasWeakReportSignatureSalt()) {
    throw new Error(
      'Unsafe report signature configuration: set NEXT_PUBLIC_REPORT_SIGNATURE_SALT before production deploy.'
    );
  }
}

export function integritySignature(payload: string): string {
  return integrityHash(`${getSignatureSalt()}|${payload}|${getSignatureSalt()}`);
}
