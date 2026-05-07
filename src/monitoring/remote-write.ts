import { logger } from '../logger';

const log = logger.child({ module: 'remote-write' });
/**
 * Prometheus remote-write was removed from this project.
 * Keep these hooks as no-ops so server startup/shutdown flow remains intact.
 */
export function startRemoteWrite(): void {
  log.info('Remote write disabled (no-op)');
}

export function stopRemoteWrite(): void {
  // no-op
}
