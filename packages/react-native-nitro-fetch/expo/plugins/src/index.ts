import withAndroidAutoPrefetch from './withAndroid';

const withNitroFetch: any = (config: any) => {
  config = withAndroidAutoPrefetch(config);
  return config;
};

export default withNitroFetch;
