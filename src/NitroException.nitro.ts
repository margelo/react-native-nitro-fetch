import type { HybridObject } from 'react-native-nitro-modules';

/**
 * Platform identifier for the exception
 */
export type ExceptionPlatform = 'android_platform' | 'ios_platform';

/**
 * Error type combining both Android and iOS error types.
 */
export type ErrorType =
  | 'network'
  | 'quic'
  | 'callback'
  | 'security'
  | 'cronet'
  | 'inlineExecution'
  | 'urlSession'
  | 'other';

/**
 * Unified request exception that works across both platforms.
 * Contains all possible fields from both Android and iOS exceptions.
 * Platform-specific fields will be undefined on the other platform.
 */
export interface RequestException extends HybridObject<{ android: 'kotlin' }> {
  readonly platform: ExceptionPlatform;
  readonly message: string;
  readonly code: number;
  readonly errorType: ErrorType;

  // Android-specific fields (undefined on iOS)
  readonly internalErrorCode?: number;
  readonly networkErrorCode?: number;
  readonly quicErrorCode?: number;
  readonly stackTrace?: string;

  // iOS-specific fields (undefined on Android)
  readonly errorDomain?: number; // 0=NSURLError, 1=NSPOSIXError, 2=CFNetwork, 3=OSStatus
  readonly localizedDescription?: string;
  readonly underlyingError?: string;
  readonly failingURL?: string;

  // Common optional fields
  readonly causeMessage?: string;
}
