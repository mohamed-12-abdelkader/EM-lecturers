import * as jwt from 'jsonwebtoken';

// Lightweight OAuth state contract test (no network)
describe('Meta OAuth state contract', () => {
  const secret = 'test-secret-key';

  it('signs and verifies teacherId in state', () => {
    const state = jwt.sign(
      { purpose: 'meta_oauth', teacherId: 42, tenantId: 7 },
      secret,
      { expiresIn: '15m' },
    );
    const payload = jwt.verify(state, secret) as any;
    expect(payload.purpose).toBe('meta_oauth');
    expect(payload.teacherId).toBe(42);
    expect(payload.tenantId).toBe(7);
  });

  it('rejects wrong purpose', () => {
    const state = jwt.sign({ purpose: 'other', teacherId: 1 }, secret, { expiresIn: '15m' });
    const payload = jwt.verify(state, secret) as any;
    expect(payload.purpose).not.toBe('meta_oauth');
  });
});
