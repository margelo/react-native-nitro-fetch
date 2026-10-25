import {
  resolvePinningFile,
  validatePinningConfig,
} from '../withCertificatePinning';

const HASH = '++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=';
const entry = (extra: Record<string, unknown> = {}) => ({
  publicKeyHashes: [HASH],
  ...extra,
});
const file = (pins: Record<string, unknown>) => JSON.stringify(pins);

describe('validatePinningConfig', () => {
  it('accepts a valid file', () => {
    expect(() =>
      validatePinningConfig(
        file({
          'API.Example.com.': entry({
            includeSubdomains: true,
            expirationDate: '2028-02-29',
          }),
          'cdn.example.com': entry(),
        })
      )
    ).not.toThrow();
  });

  it('accepts an empty object (pinning off)', () => {
    expect(() => validatePinningConfig('{}')).not.toThrow();
  });

  it.each([
    ['unquoted keys', `{api.example.com: {"publicKeyHashes": ["${HASH}"]}}`],
    ['trailing content', `${file({ 'a.com': entry() })} {}`],
    ['a top-level array', '[]'],
  ])('rejects non-strict JSON: %s', (_, json) => {
    expect(() => validatePinningConfig(json)).toThrow();
  });

  it.each([
    ['a URL', 'https://api.example.com'],
    ['a port', 'api.example.com:443'],
    ['a wildcard', '*.example.com'],
    ['an IP address', '10.0.0.1'],
    ['surrounding whitespace', 'api.example.com\n'],
  ])('rejects a key that is %s', (_, key) => {
    expect(() => validatePinningConfig(file({ [key]: entry() }))).toThrow(
      'is not a hostname'
    );
  });

  it('rejects the same host listed twice after normalising', () => {
    expect(() =>
      validatePinningConfig(
        file({ 'API.example.com': entry(), 'api.example.com.': entry() })
      )
    ).toThrow('already in the file');
  });

  it.each([
    ['written twice', '"a.com"'],
    ['written with an escape', '"a\\u002ecom"'],
  ])('rejects the same host key %s', (_, second) => {
    const e = JSON.stringify(entry());
    expect(() =>
      validatePinningConfig(`{"a.com": ${e}, "b.com": ${e}, ${second}: ${e}}`)
    ).toThrow('"a.com" lists a host that is already in the file');
  });

  it('only counts top-level keys as hosts', () => {
    const nested = { 'note': '"b.com": {', 'b.com': true, ...entry() };
    expect(() =>
      validatePinningConfig(file({ 'a.com': nested, 'b.com': entry() }))
    ).not.toThrow();
  });

  it.each([
    ['missing', {}],
    ['empty', { publicKeyHashes: [] }],
    ['not an array', { publicKeyHashes: HASH }],
  ])('rejects publicKeyHashes that is %s', (_, value) => {
    expect(() => validatePinningConfig(file({ 'a.com': value }))).toThrow(
      'needs at least one entry'
    );
  });

  it.each([
    ['unpadded', HASH.slice(0, -1)],
    ['too short', 'AAAA'],
    ['URL-safe alphabet', HASH.replace('+', '-')],
    ['containing a space', `${HASH.slice(0, 20)} ${HASH.slice(21)}`],
    ['a number', 42],
  ])('rejects a hash that is %s', (_, hash) => {
    expect(() =>
      validatePinningConfig(file({ 'a.com': { publicKeyHashes: [hash] } }))
    ).toThrow("isn't a base64 SHA-256 hash");
  });

  it.each([['true'], [1], [null]])('rejects includeSubdomains %p', (value) => {
    expect(() =>
      validatePinningConfig(
        file({ 'a.com': entry({ includeSubdomains: value }) })
      )
    ).toThrow('includeSubdomains must be true or false');
  });

  it.each([['2027-02-30'], ['2027-13-01'], ['2027-1-1'], [['2027-06-01']]])(
    'rejects expirationDate %p',
    (value) => {
      expect(() =>
        validatePinningConfig(
          file({ 'a.com': entry({ expirationDate: value }) })
        )
      ).toThrow('expirationDate must be yyyy-MM-dd');
    }
  );
});

describe('resolvePinningFile', () => {
  it('fails when the file does not exist', () => {
    expect(() => resolvePinningFile(__dirname, './missing.json')).toThrow(
      'file not found'
    );
  });
});
