import { Platform } from 'react-native';

// Base URL of the local httpbin-compatible Express server (test-server/) that
// CI starts on the runner host before the harness suites run. The emulator and
// simulator reach the host through different loopback aliases:
//   - Android emulator -> 10.0.2.2
//   - iOS simulator    -> 127.0.0.1 (shares the host network namespace)
const PORT = 9876;
const HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

export const BASE = `http://${HOST}:${PORT}`;
