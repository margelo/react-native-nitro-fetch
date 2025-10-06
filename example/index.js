import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

import 'event-target-polyfill';

AppRegistry.registerComponent(appName, () => App);
