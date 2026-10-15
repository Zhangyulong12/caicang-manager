import { Throttle } from '@nestjs/throttler';
/** Milliseconds; per route and client IP. Apply to future login/register/refresh endpoints. */
export const SensitiveRateLimit = () => Throttle({ default: { limit: 5, ttl: 60000 } });
