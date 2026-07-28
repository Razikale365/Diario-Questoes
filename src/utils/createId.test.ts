import assert from 'node:assert/strict';
import test from 'node:test';

type CreateIdModule = typeof import('./createId');

const loadCreateId = async (): Promise<Partial<CreateIdModule>> => {
  try {
    return await import('./createId');
  } catch {
    return {};
  }
};

test('creates an RFC 4122 version 4 id when randomUUID is unavailable', async () => {
  // Given: a browser crypto implementation without randomUUID.
  const sut = await loadCreateId();
  assert.equal(typeof sut.createId, 'function');
  const cryptoWithoutRandomUuid = {
    getRandomValues: (bytes: Uint8Array): Uint8Array => {
      bytes.fill(0);
      return bytes;
    },
  };

  // When: an id is requested.
  const id = sut.createId!(cryptoWithoutRandomUuid);

  // Then: the fallback preserves the UUID v4 version and variant bits.
  assert.equal(id, '00000000-0000-4000-8000-000000000000');
});
