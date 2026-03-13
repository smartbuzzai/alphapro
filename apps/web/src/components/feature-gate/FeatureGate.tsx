'use client';

import { useFlag, useVariant } from '@unleash/nextjs/client';

// ─────────────────────────────────────────────
// Basic Feature Gate — show/hide UI by flag
// ─────────────────────────────────────────────
interface FeatureGateProps {
  /** Unleash feature flag name */
  flag: string;
  /** Content to show when flag is enabled */
  children: React.ReactNode;
  /** Optional fallback when flag is disabled */
  fallback?: React.ReactNode;
}

/**
 * Wraps content behind an Unleash feature flag.
 * Renders children only when the flag is enabled.
 *
 * @example
 * <FeatureGate flag="new-dashboard" fallback={<OldDashboard />}>
 *   <NewDashboard />
 * </FeatureGate>
 */
export function FeatureGate({ flag, children, fallback = null }: FeatureGateProps) {
  const { enabled } = useFlag(flag);
  return <>{enabled ? children : fallback}</>;
}

// ─────────────────────────────────────────────
// Variant Gate — A/B testing with variants
// ─────────────────────────────────────────────
interface VariantGateProps {
  flag: string;
  variant: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Renders children only when the flag is enabled AND
 * the user is assigned the specified variant.
 *
 * @example
 * <VariantGate flag="checkout-flow" variant="streamlined">
 *   <StreamlinedCheckout />
 * </VariantGate>
 */
export function VariantGate({ flag, variant, children, fallback = null }: VariantGateProps) {
  const variantData = useVariant(flag);
  const isActive = variantData.enabled && variantData.name === variant;
  return <>{isActive ? children : fallback}</>;
}

// ─────────────────────────────────────────────
// Hook for programmatic flag checks
// ─────────────────────────────────────────────
/**
 * @example
 * const { canExport, isNewUI } = useFeatureFlags();
 * if (canExport) { ... }
 */
export function useFeatureFlags() {
  return {
    isNewDashboard: useFlag('new-dashboard').enabled,
    canExport: useFlag('data-export').enabled,
    hasAdvancedFilters: useFlag('advanced-filters').enabled,
    isMaintenanceMode: useFlag('maintenance-mode').enabled,
  };
}
