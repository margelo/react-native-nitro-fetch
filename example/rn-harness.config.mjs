import {
  androidPlatform,
  androidEmulator,
} from '@react-native-harness/platform-android';
import {
  applePlatform,
  appleSimulator,
} from '@react-native-harness/platform-apple';

const androidAvd = process.env.HARNESS_ANDROID_AVD ?? 'Pixel_8_API_35';
const androidDevice = androidEmulator(androidAvd);

const config = {
  entryPoint: './index.js',
  appRegistryComponentName: 'NitroFetchExample',

  runners: [
    androidPlatform({
      name: 'android',
      device: androidDevice,
      bundleId: 'nitrofetch.example', // Your Android bundle ID
    }),
    applePlatform({
      name: 'ios',
      device: appleSimulator('iPhone 17 Pro', '26.2'), // Your iOS simulator name and version
      bundleId: 'nitrofetch.example', // Your iOS bundle ID
    }),
  ],
  defaultRunner: 'android',
  bridgeTimeout: 180000,
  bundleStartTimeout: 30000,
  forwardClientLogs: true,
};

export default config;
