/**
 * Fails the build when OpenAPI YAML is invalid (duplicate keys, broken $ref, etc.).
 */
const path = require('path');
const SwaggerParser = require('@apidevtools/swagger-parser');

const specs = [
  path.join(__dirname, '../dist/docs/openapi/index.yaml'),
  path.join(__dirname, '../dist/docs/openapi/admin-index.yaml'),
];

(async () => {
  for (const specPath of specs) {
    await SwaggerParser.bundle(specPath);
    console.log(`OpenAPI OK: ${path.basename(specPath)}`);
  }
})().catch((err) => {
  console.error('OpenAPI validation failed:', err.message);
  process.exit(1);
});
