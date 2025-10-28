/**
 * Input Component
 *
 * Reusable text input with label, validation, and icon support
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type { InputProps } from '../../types/components.types';

export const Input: React.FC<InputProps> = ({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  disabled = false,
  leftIcon,
  rightIcon,
  required = false,
  style,
  testID,
}) => {
  const { theme } = useTheme();
  const hasError = !!error;

  return (
    <View style={[styles.container, style]} testID={testID}>
      {label && (
        <View style={styles.labelContainer}>
          <Text style={[styles.label, { color: theme.colors.textPrimary }]}>
            {label}
            {required && <Text style={[styles.required, { color: theme.colors.error }]}> *</Text>}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: theme.colors.formBackground,
            borderColor: hasError ? theme.colors.error : theme.colors.formBorder,
          },
          disabled && styles.inputContainerDisabled,
        ]}>
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}

        <TextInput
          style={[
            styles.input,
            { color: theme.colors.formText },
            leftIcon && styles.inputWithLeftIcon,
            rightIcon && styles.inputWithRightIcon,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textTertiary}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          editable={!disabled}
        />

        {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
      </View>

      {hasError && <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },

  labelContainer: {
    marginBottom: 8,
  },

  label: {
    fontSize: 14,
    fontWeight: '500',
  },

  required: {
    // color applied dynamically
  },

  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    minHeight: 44,
  },

  inputContainerDisabled: {
    opacity: 0.6,
  },

  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
  },

  inputWithLeftIcon: {
    marginLeft: 8,
  },

  inputWithRightIcon: {
    marginRight: 8,
  },

  leftIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  rightIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  errorText: {
    fontSize: 14,
    marginTop: 4,
  },
});
