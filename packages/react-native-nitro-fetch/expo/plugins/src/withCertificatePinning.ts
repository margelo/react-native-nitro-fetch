import * as fs from 'fs';
import * as path from 'path';
import {
  IOSConfig,
  withDangerousMod,
  withXcodeProject,
} from '@expo/config-plugins';

// The name the native code looks up: CertificatePinning.CONFIG_FILE (Android) / configFile (iOS).
const PINNING_FILE = 'nitro-fetch-pinning.json';

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
// A SHA-256 hash in standard, padded base64 is always 43 alphabet characters plus "=".
const HASH = /^[A-Za-z0-9+/]{43}=$/;

function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Throws if `json` isn't a pin file the native code will accept. The rules match the Android and
 * iOS parsers exactly, so a file that passes here never fails closed at runtime.
 */
export function validatePinningConfig(json: string): void {
  let pins: any;
  try {
    pins = JSON.parse(json);
  } catch (e: any) {
    throw new Error(`not valid JSON (${e.message})`);
  }
  if (!pins || typeof pins !== 'object' || Array.isArray(pins)) {
    throw new Error('expected a JSON object keyed by hostname');
  }
  const repeated = repeatedKeys(json);
  const hosts = new Set<string>();
  for (const [key, entry] of Object.entries<any>(pins)) {
    const host = key.toLowerCase().replace(/\.$/, '');
    if (!HOSTNAME.test(host) || /^[0-9.]+$/.test(host)) {
      throw new Error(
        `"${key}" is not a hostname (no scheme, port, path, wildcard or IP; use punycode for IDNs)`
      );
    }
    if (hosts.has(host) || repeated.has(key)) {
      throw new Error(`"${key}" lists a host that is already in the file`);
    }
    hosts.add(host);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`"${key}" must be an object`);
    }
    const hashes = entry.publicKeyHashes;
    if (!Array.isArray(hashes) || hashes.length === 0) {
      throw new Error(`"${key}" needs at least one entry in publicKeyHashes`);
    }
    for (const hash of hashes) {
      if (typeof hash !== 'string' || !HASH.test(hash)) {
        throw new Error(
          `"${key}" has a publicKeyHashes entry that isn't a base64 SHA-256 hash: ${hash}`
        );
      }
    }
    if (
      entry.includeSubdomains !== undefined &&
      typeof entry.includeSubdomains !== 'boolean'
    ) {
      throw new Error(`"${key}".includeSubdomains must be true or false`);
    }
    if (
      entry.expirationDate !== undefined &&
      !isCalendarDate(entry.expirationDate)
    ) {
      throw new Error(`"${key}".expirationDate must be yyyy-MM-dd`);
    }
  }
}

/**
 * The top-level keys that appear more than once. JSON.parse keeps one value per key, so the repeats
 * are found in the raw text. `json` must already parse as a JSON object.
 */
function repeatedKeys(json: string): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  let depth = 0;
  let expectingKey = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (c === '"') {
      const start = i;
      for (i++; i < json.length && json[i] !== '"'; i++) {
        if (json[i] === '\\') i++;
      }
      if (depth === 1 && expectingKey) {
        const key: string = JSON.parse(json.slice(start, i + 1));
        if (seen.has(key)) repeated.add(key);
        seen.add(key);
      }
      expectingKey = false;
    } else if (c === '{' || c === '[') {
      depth++;
      expectingKey = depth === 1;
    } else if (c === '}' || c === ']') {
      depth--;
    } else if (c === ',') {
      expectingKey = depth === 1;
    }
  }
  return repeated;
}

/** Resolves the pin file from the project root and validates it, so mistakes fail `expo prebuild`. */
export function resolvePinningFile(projectRoot: string, file: string): string {
  const source = path.resolve(projectRoot, file);
  const prefix = `[react-native-nitro-fetch] certificatePinning (${file})`;
  if (!fs.existsSync(source)) throw new Error(`${prefix}: file not found`);
  try {
    validatePinningConfig(fs.readFileSync(source, 'utf8'));
  } catch (e: any) {
    throw new Error(`${prefix}: ${e.message}`);
  }
  return source;
}

/**
 * Bundles the app's pin file where nitro-fetch reads it: Android assets and the iOS app target's
 * resources.
 */
const withCertificatePinning = (config: any, file: string) => {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const source = resolvePinningFile(cfg.modRequest.projectRoot, file);
      const assets = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/assets'
      );
      fs.mkdirSync(assets, { recursive: true });
      fs.copyFileSync(source, path.join(assets, PINNING_FILE));
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    const { projectRoot, platformProjectRoot } = cfg.modRequest;
    const source = resolvePinningFile(projectRoot, file);
    const projectName =
      cfg.modRequest.projectName ??
      IOSConfig.XcodeUtils.getProjectName(projectRoot);
    fs.copyFileSync(
      source,
      path.join(platformProjectRoot, projectName, PINNING_FILE)
    );

    const filepath = `${projectName}/${PINNING_FILE}`;
    if (!cfg.modResults.hasFile(filepath)) {
      cfg.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath,
        groupName: projectName,
        isBuildFile: true,
        project: cfg.modResults,
      });
    }
    return cfg;
  });

  return config;
};

export default withCertificatePinning;
