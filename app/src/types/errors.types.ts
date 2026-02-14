/**
 * Custom Error Type Definitions
 *
 * Typed error classes for better error handling and user messaging
 */

export class BleError extends Error {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  constructor(
    message: string,
    public code: BleErrorCode,
    public userMessage?: string,
  ) {
    super(message);
    this.name = 'BleError';
    Object.setPrototypeOf(this, BleError.prototype);
  }
}

export type BleErrorCode =
  | 'BLUETOOTH_OFF'
  | 'PERMISSION_DENIED'
  | 'DEVICE_NOT_FOUND'
  | 'CONNECTION_FAILED'
  | 'DISCONNECTED'
  | 'CHARACTERISTIC_NOT_FOUND'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'SCAN_FAILED'
  | 'UNKNOWN';

export class RecordingError extends Error {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  constructor(
    message: string,
    public code: RecordingErrorCode,
    public userMessage?: string,
  ) {
    super(message);
    this.name = 'RecordingError';
    Object.setPrototypeOf(this, RecordingError.prototype);
  }
}

export type RecordingErrorCode =
  | 'DEVICE_NOT_CONNECTED'
  | 'START_FAILED'
  | 'STOP_FAILED'
  | 'SAVE_FAILED'
  | 'PERMISSION_DENIED'
  | 'STORAGE_FULL'
  | 'INVALID_DATA'
  | 'UNKNOWN';

export class AuthError extends Error {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  constructor(
    message: string,
    public code: AuthErrorCode,
    public userMessage?: string,
  ) {
    super(message);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_CONFIRMED'
  | 'USER_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'SESSION_EXPIRED'
  | 'UNKNOWN';

// Union type for all app errors
export type AppError = BleError | RecordingError | AuthError;

// Type guard functions
export function isBleError(error: unknown): error is BleError {
  return error instanceof BleError;
}

export function isRecordingError(error: unknown): error is RecordingError {
  return error instanceof RecordingError;
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export function isAppError(error: unknown): error is AppError {
  return isBleError(error) || isRecordingError(error) || isAuthError(error);
}
