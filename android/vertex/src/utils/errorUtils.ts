/**
 * Error Utility Functions
 *
 * Helper functions for error handling and user-friendly messages
 */

import {
  AppError,
  BleError,
  RecordingError,
  AuthError,
  isBleError,
  isRecordingError,
  isAuthError,
} from '../types/errors.types';

/**
 * Type guard to check if value is an Error
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (isAppError(error)) {
    return error.userMessage || error.message;
  }
  if (isError(error)) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
}

/**
 * Get user-friendly error message based on error type
 */
export function getUserFriendlyError(error: unknown): string {
  if (isBleError(error)) {
    return getBleErrorMessage(error);
  }
  if (isRecordingError(error)) {
    return getRecordingErrorMessage(error);
  }
  if (isAuthError(error)) {
    return getAuthErrorMessage(error);
  }
  return getErrorMessage(error);
}

/**
 * Get user-friendly BLE error message
 */
function getBleErrorMessage(error: BleError): string {
  if (error.userMessage) {
    return error.userMessage;
  }

  switch (error.code) {
    case 'BLUETOOTH_OFF':
      return 'Bluetooth is turned off. Please enable Bluetooth to connect to devices.';
    case 'PERMISSION_DENIED':
      return 'Bluetooth permission denied. Please enable Bluetooth permissions in settings.';
    case 'DEVICE_NOT_FOUND':
      return 'Device not found. Make sure the device is turned on and nearby.';
    case 'CONNECTION_FAILED':
      return 'Failed to connect to device. Please try again.';
    case 'DISCONNECTED':
      return 'Device disconnected unexpectedly.';
    case 'CHARACTERISTIC_NOT_FOUND':
      return 'Device communication error. Please reconnect and try again.';
    case 'READ_FAILED':
      return 'Failed to read data from device.';
    case 'WRITE_FAILED':
      return 'Failed to send data to device.';
    case 'SCAN_FAILED':
      return 'Failed to scan for devices. Please try again.';
    default:
      return 'Bluetooth error occurred. Please try again.';
  }
}

/**
 * Get user-friendly Recording error message
 */
function getRecordingErrorMessage(error: RecordingError): string {
  if (error.userMessage) {
    return error.userMessage;
  }

  switch (error.code) {
    case 'DEVICE_NOT_CONNECTED':
      return 'Device not connected. Please connect to a device first.';
    case 'START_FAILED':
      return 'Failed to start recording. Please try again.';
    case 'STOP_FAILED':
      return 'Failed to stop recording. Please try again.';
    case 'SAVE_FAILED':
      return 'Failed to save recording data.';
    case 'PERMISSION_DENIED':
      return 'Storage permission denied. Please enable storage permissions in settings.';
    case 'STORAGE_FULL':
      return 'Storage is full. Please free up space and try again.';
    case 'INVALID_DATA':
      return 'Received invalid data from device.';
    default:
      return 'Recording error occurred. Please try again.';
  }
}

/**
 * Get user-friendly Auth error message
 */
function getAuthErrorMessage(error: AuthError): string {
  if (error.userMessage) {
    return error.userMessage;
  }

  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'Invalid email or password. Please try again.';
    case 'EMAIL_NOT_CONFIRMED':
      return 'Email not confirmed. Please check your email for confirmation link.';
    case 'USER_NOT_FOUND':
      return 'User not found. Please check your credentials.';
    case 'NETWORK_ERROR':
      return 'Network error. Please check your internet connection.';
    case 'SESSION_EXPIRED':
      return 'Your session has expired. Please sign in again.';
    default:
      return 'Authentication error occurred. Please try again.';
  }
}

/**
 * Check if error is an AppError
 */
function isAppError(error: unknown): error is AppError {
  return isBleError(error) || isRecordingError(error) || isAuthError(error);
}

/**
 * Log error with context
 */
export function logError(error: unknown, context?: string): void {
  const message = context ? `[${context}]` : '';
  console.error(`${message} Error:`, error);
}
