const path = require('path');
const { getConfig } = require('react-native-builder-bob/babel-config');
const pkg = require('../package/package.json');

const root = path.resolve(__dirname, '..', 'package');

module.exports = getConfig(
  {
    presets: ['module:@react-native/babel-preset'],
    plugins: ["react-native-worklets-core/plugin"],
  },
  { root, pkg }
);
