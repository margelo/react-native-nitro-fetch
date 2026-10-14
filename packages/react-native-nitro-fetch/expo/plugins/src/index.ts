import withAndroidAutoPrefetch from './withAndroid';
import withCertificatePinning from './withCertificatePinning';

type NitroFetchPluginProps = {
  /** Path, from the project root, to a nitro-fetch-pinning.json to bundle with the app. */
  certificatePinning?: string;
};

const withNitroFetch: any = (
  config: any,
  props: NitroFetchPluginProps | null = {}
) => {
  config = withAndroidAutoPrefetch(config);
  if (props?.certificatePinning) {
    config = withCertificatePinning(config, props.certificatePinning);
  }
  return config;
};

export default withNitroFetch;
