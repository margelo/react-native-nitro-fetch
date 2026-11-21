import withAndroidAutoPrefetch from './withAndroid';
import withCertificatePinning from './withCertificatePinning';
import withDisableCookies from './withDisableCookies';

type NitroFetchPluginProps = {
  /** Path, from the project root, to a nitro-fetch-pinning.json to bundle with the app. */
  certificatePinning?: string;
  /** iOS: keep every request out of the shared cookie jar (sets NitroFetchDisableCookies in Info.plist). */
  disableCookies?: boolean;
};

const withNitroFetch: any = (
  config: any,
  props: NitroFetchPluginProps | null = {}
) => {
  config = withAndroidAutoPrefetch(config);
  if (props?.certificatePinning) {
    config = withCertificatePinning(config, props.certificatePinning);
  }
  if (props?.disableCookies) {
    config = withDisableCookies(config);
  }
  return config;
};

export default withNitroFetch;
