/**
 * BottomSheet Component
 *
 * Themed bottom sheet for option selection
 */

import React, { useEffect, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import { Check } from 'lucide-react-native';
import { theme as staticTheme } from '../../styles/theme';
import { useTheme } from '../../contexts/ThemeContext';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface BottomSheetOption {
  label: string;
  value: string | number;
  description?: string;
}

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: BottomSheetOption[];
  selectedValue?: string | number;
  onSelect: (value: string | number) => void;
}

const BottomSheetComponent: React.FC<BottomSheetProps> = ({
  visible,
  onClose,
  title,
  options,
  selectedValue,
  onSelect,
}) => {
  const { theme } = useTheme();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const handleSelect = (value: string | number) => {
    onSelect(value);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[styles.overlay, { opacity }]}>
          <TouchableWithoutFeedback>
            <Animated.View
              style={[
                styles.container,
                {
                  backgroundColor: theme.colors.background,
                  transform: [{ translateY }],
                },
              ]}
            >
              {/* Handle */}
              <View style={styles.handleContainer}>
                <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
              </View>

              {/* Title */}
              <View style={styles.header}>
                <Text
                  style={[
                    styles.title,
                    { color: theme.colors.textPrimary, fontFamily: staticTheme.typography.serif },
                  ]}
                >
                  {title}
                </Text>
              </View>

              {/* Options */}
              <ScrollView style={styles.optionsContainer} bounces={false}>
                {options.map((option) => {
                  const isSelected = option.value === selectedValue;
                  return (
                    <TouchableOpacity
                      key={String(option.value)}
                      style={[
                        styles.option,
                        {
                          backgroundColor: isSelected
                            ? theme.colors.muted
                            : theme.colors.card,
                          borderColor: theme.colors.border,
                        },
                      ]}
                      onPress={() => handleSelect(option.value)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.optionContent}>
                        <View style={styles.optionText}>
                          <Text
                            style={[
                              styles.optionLabel,
                              {
                                color: theme.colors.textPrimary,
                                fontFamily: staticTheme.typography.serif,
                              },
                            ]}
                          >
                            {option.label}
                          </Text>
                          {option.description && (
                            <Text
                              style={[
                                styles.optionDescription,
                                {
                                  color: theme.colors.textSecondary,
                                  fontFamily: staticTheme.typography.serif,
                                },
                              ]}
                            >
                              {option.description}
                            </Text>
                          )}
                        </View>
                        {isSelected && (
                          <Check size={20} color={theme.colors.primary} strokeWidth={3} />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: staticTheme.borderRadius.xl,
    borderTopRightRadius: staticTheme.borderRadius.xl,
    paddingBottom: staticTheme.spacing.xl,
    maxHeight: SCREEN_HEIGHT * 0.75,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: staticTheme.spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    paddingHorizontal: staticTheme.spacing.lg,
    paddingBottom: staticTheme.spacing.md,
  },
  title: {
    fontSize: staticTheme.typography.fontSize.xl,
    fontWeight: staticTheme.typography.fontWeight.semibold,
  },
  optionsContainer: {
    paddingHorizontal: staticTheme.spacing.lg,
  },
  option: {
    borderRadius: staticTheme.borderRadius.md,
    marginBottom: staticTheme.spacing.sm,
    borderWidth: 1,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: staticTheme.spacing.md,
  },
  optionText: {
    flex: 1,
    marginRight: staticTheme.spacing.md,
  },
  optionLabel: {
    fontSize: staticTheme.typography.fontSize.md,
    fontWeight: staticTheme.typography.fontWeight.medium,
    marginBottom: 2,
  },
  optionDescription: {
    fontSize: staticTheme.typography.fontSize.sm,
    lineHeight: 18,
  },
});

export const BottomSheet = memo(BottomSheetComponent);
