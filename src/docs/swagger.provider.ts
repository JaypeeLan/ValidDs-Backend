import path from 'path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { logger } from '../logger';

const log = logger.child({ module: 'swagger-provider' });

/**
 * Loads and bundles the modular OpenAPI specification.
 *
 * In production, we could cache this, but for now, we resolve it on startup.
 */
export async function getSwaggerSpec(): Promise<object> {
  const rootPath = path.join(__dirname, 'openapi/index.yaml');

  try {
    // Resolve all $ref links (even external files) into a single bundle
    const bundledSpec = await SwaggerParser.bundle(rootPath);

    log.info('Swagger specification bundled successfully');
    return bundledSpec;
  } catch (err) {
    log.error('Failed to bundle Swagger specification', err);
    // Return a minimal spec so the app doesn't crash, but the error is logged
    return { openapi: '3.0.0', info: { title: 'Error', version: '0.0.0' }, paths: {} };
  }
}

/** `/api/v1/admin/*` only — same `paths/` + `components/` files as the main spec; entry is `openapi/admin-index.yaml`. */
export async function getAdminSwaggerSpec(): Promise<object> {
  const rootPath = path.join(__dirname, 'openapi/admin-index.yaml');

  try {
    const bundledSpec = await SwaggerParser.bundle(rootPath);
    log.info('Admin Swagger specification bundled successfully');
    return bundledSpec;
  } catch (err) {
    log.error('Failed to bundle Admin Swagger specification', err);
    return { openapi: '3.0.0', info: { title: 'Error', version: '0.0.0' }, paths: {} };
  }
}
