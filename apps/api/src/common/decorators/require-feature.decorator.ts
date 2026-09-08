import { SetMetadata } from '@nestjs/common';

export const FEATURE_FLAG_KEY = 'featureFlag';

/**
 * Gates a controller (or single handler) behind a FeatureFlag key —
 * spec #39. Checked by FeatureFlagGuard IN ADDITION to, never instead
 * of, the route's normal @RequirePermissions/@Roles checks: those guards
 * run earlier in the global guard order (see app.module.ts), so an
 * unauthorized caller is already rejected before this guard ever asks
 * whether the feature itself is switched on.
 */
export const RequireFeature = (key: string) => SetMetadata(FEATURE_FLAG_KEY, key);
