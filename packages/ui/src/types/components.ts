/**
 * Shared component prop types.
 *
 * These define the variant contracts that both web and mobile
 * components should implement. Not all variants need to exist
 * on both platforms — these are the canonical names.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type BadgeVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export type CardVariant = 'default' | 'elevated' | 'interactive'
