// src/host.js
// Deterministic per-machine host fingerprint for bundle manifests.
// Per resolved Q #9: SHA-256 hex of os.hostname(). No raw PII in the bundle.

import { hostname } from 'node:os';
import { createHash } from 'node:crypto';

/**
 * Return SHA-256 hex (64 chars) of the OS hostname.
 * @returns {string}
 */
export function hostFingerprint() {
  return createHash('sha256').update(hostname()).digest('hex');
}
