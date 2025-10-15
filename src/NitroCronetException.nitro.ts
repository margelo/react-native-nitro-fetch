import type { HybridObject } from 'react-native-nitro-modules';

export enum NetworkExceptionErrorCode {
  ERROR_HOSTNAME_NOT_RESOLVED = 1,
  ERROR_INTERNET_DISCONNECTED = 2,
  ERROR_NETWORK_CHANGED = 3,
  ERROR_TIMED_OUT = 4,
  ERROR_CONNECTION_CLOSED = 5,
  ERROR_CONNECTION_TIMED_OUT = 6,
  ERROR_CONNECTION_REFUSED = 7,
  ERROR_CONNECTION_RESET = 8,
  ERROR_ADDRESS_UNREACHABLE = 9,
  ERROR_QUIC_PROTOCOL_FAILED = 10,
  ERROR_OTHER = 11,
}

export interface CronetException
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly message: string;
  readonly internalErrorCode: number;
}

export interface NetworkException
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }>,
    CronetException {
  readonly errorCode: number;
}

export interface QuicException
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }>,
    CronetException {
  readonly quicDetailedErrorCode: number;
}

export interface CallbackException
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }>,
    CronetException {
  readonly cause?: string;
}

export interface InlineExecutionProhibitedException
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }>,
    CronetException {}
