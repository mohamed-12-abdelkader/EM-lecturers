import { decryptSecret, encryptSecret } from './secretCrypto';

describe('secretCrypto', () => {
  const prev = process.env.META_TOKEN_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.META_TOKEN_ENCRYPTION_KEY = 'test-encryption-key-for-social';
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.META_TOKEN_ENCRYPTION_KEY;
    else process.env.META_TOKEN_ENCRYPTION_KEY = prev;
  });

  it('encrypts and decrypts round-trip', () => {
    const plain = 'EAAB_test_token_123';
    const enc = encryptSecret(plain);
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('returns plaintext unchanged when already plain', () => {
    expect(decryptSecret('plain-token')).toBe('plain-token');
  });
});
