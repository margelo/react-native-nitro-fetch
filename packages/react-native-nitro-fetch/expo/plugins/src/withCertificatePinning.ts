import fs from 'fs';
import path from 'path';
import {
  IOSConfig,
  withDangerousMod,
  withXcodeProject,
} from '@expo/config-plugins';

// The name the native code looks up: CertificatePinning.CONFIG_FILE (Android) / configFile (iOS).
const PINNING_FILE = 'nitro-fetch-pinning.json';

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Resolves the pin file and checks it the way the native code will, so a mistake fails
 * `expo prebuild` instead of every request at runtime.
 */
function resolvePinningFile(projectRoot: string, file: string): string {
  const source = path.resolve(projectRoot, file);
  const fail = (reason: string): never => {
    throw new Error(
      `[react-native-nitro-fetch] certificatePinning (${file}): ${reason}`
    );
  };
  if (!fs.existsSync(source)) fail('file not found');

  let pins: any;
  try {
    pins = JSON.parse(fs.readFileSync(source, 'utf8'));
  } catch (e: any) {
    fail(`invalid JSON (${e.message})`);
  }
  if (!pins || typeof pins !== 'object' || Array.isArray(pins)) {
    fail('expected a JSON object keyed by hostname');
  }
  for (const [host, entry] of Object.entries<any>(pins)) {
    const normalized = host.trim().toLowerCase().replace(/\.$/, '');
    if (!HOSTNAME.test(normalized) || /^[0-9.]+$/.test(normalized)) {
      fail(
        `"${host}" is not a hostname (no scheme, port, path, wildcard or IP)`
      );
    }
    const hashes = entry?.publicKeyHashes;
    if (!Array.isArray(hashes) || hashes.length === 0) {
      fail(`"${host}" needs at least one entry in publicKeyHashes`);
    }
    for (const hash of hashes) {
      const valid =
        typeof hash === 'string' &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(hash) &&
        Buffer.from(hash, 'base64').length === 32;
      if (!valid) {
        fail(
          `"${host}" has a publicKeyHashes entry that isn't a base64 SHA-256 hash: ${hash}`
        );
      }
    }
    if (
      entry.includeSubdomains !== undefined &&
      typeof entry.includeSubdomains !== 'boolean'
    ) {
      fail(`"${host}".includeSubdomains must be true or false`);
    }
    if (
      entry.expirationDate !== undefined &&
      !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.expirationDate))
    ) {
      fail(`"${host}".expirationDate must be yyyy-MM-dd`);
    }
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
