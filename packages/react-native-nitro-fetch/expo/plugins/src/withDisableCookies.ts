import { withInfoPlist } from '@expo/config-plugins';

// The key NitroURLSession.cookiesDisabled reads on iOS.
const INFO_PLIST_KEY = 'NitroFetchDisableCookies';

const withDisableCookies = (config: any) =>
  withInfoPlist(config, (cfg) => {
    cfg.modResults[INFO_PLIST_KEY] = true;
    return cfg;
  });

export default withDisableCookies;
