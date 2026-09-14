import {
  buildNitroRequest,
  buildNitroRequestPure,
} from '../fetch-core/request';

const url = 'https://example.com/slow';

describe('timeoutMs', () => {
  it('forwards init.timeoutMs to the native request', () => {
    expect(buildNitroRequest(url, { timeoutMs: 240_000 }).timeoutMs).toBe(
      240_000
    );
    expect(buildNitroRequestPure(url, { timeoutMs: 240_000 }).timeoutMs).toBe(
      240_000
    );
  });

  it('leaves timeoutMs undefined when init does not set it', () => {
    expect(buildNitroRequest(url).timeoutMs).toBeUndefined();
    expect(buildNitroRequestPure(url, {}).timeoutMs).toBeUndefined();
  });

  it('ignores a non-numeric timeoutMs', () => {
    expect(
      buildNitroRequest(url, { timeoutMs: '5000' as any }).timeoutMs
    ).toBeUndefined();
    expect(
      buildNitroRequestPure(url, { timeoutMs: null as any }).timeoutMs
    ).toBeUndefined();
  });
});
