import { readFile, writeFile } from 'node:fs/promises';

const [publicFile, externalFile, outputFile] = process.argv.slice(2);
if (!publicFile || !externalFile || !outputFile) {
  throw new Error('Usage: node scripts/generate-api-contract-fixture.mjs <public-openapi.json> <external-openapi.json> <output.json>');
}

const [publicApi, externalApi] = await Promise.all([
  readFile(publicFile, 'utf8').then(JSON.parse),
  readFile(externalFile, 'utf8').then(JSON.parse),
]);
const prefixes = [
  { source: externalApi, prefix: '/api/external/v1' },
  { source: publicApi, prefix: '' },
];
const senderPaths = [
  '/api/external/v1/sync/push/{contentId}',
  '/api/external/v1/sync/upload-image/{contentId}',
  '/api/external/v1/sync/pull/{contentId}',
  '/api/external/v1/sync/upsert',
  '/api/external/v1/sync/tenant',
  '/api/external/v1/cli-auth/exchange',
  '/api/external/v1/api-keys',
  '/api/external/v1/api-keys/{keyId}',
  '/api/v1/contents',
  '/api/v1/contents/{contentId}/extensions',
  '/api/v1/contents/{contentId}/extensions/{extensionId}',
  '/api/v1/contents/tables/{contentId}/columns',
  '/api/v1/contents/tables/{contentId}/rows',
];
const output = {
  openapi: '3.1.0',
  info: { title: 'Memoreru CLI sender contract', version: '1.0.0' },
  components: { schemas: {} },
  paths: {},
};
const seenSchemas = new Set();
function resolveSchema(schema, components) {
  if (!schema) return schema;
  if (schema.$ref?.startsWith('#/components/schemas/')) {
    const name = schema.$ref.split('/').at(-1);
    if (!seenSchemas.has(name)) {
      seenSchemas.add(name);
      const definition = components.schemas?.[name];
      if (definition) output.components.schemas[name] = resolveSchema(definition, components);
    }
    return { $ref: schema.$ref };
  }
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [
    key,
    key === 'properties'
      ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, resolveSchema(child, components)]))
      : key === 'items' || key === 'additionalProperties'
        ? typeof value === 'object' ? resolveSchema(value, components) : value
        : Array.isArray(value) ? value.map(child => typeof child === 'object' ? resolveSchema(child, components) : child)
          : typeof value === 'object' ? resolveSchema(value, components) : value,
  ]));
}
function resolveMedia(content, components) {
  return Object.fromEntries(Object.entries(content ?? {}).map(([type, media]) => [
    type, { ...media, schema: resolveSchema(media.schema, components) },
  ]));
}
for (const path of senderPaths) {
  const source = prefixes.find(item => path.startsWith(item.prefix + '/'));
  if (!source) throw new Error(`No OpenAPI source selected for ${path}`);
  const sourcePath = path.slice(source.prefix.length);
  const sourceItem = source.source.paths[sourcePath];
  if (!sourceItem) throw new Error(`OpenAPI operation path missing: ${sourcePath}`);
  const pathItem = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const operation = sourceItem[method];
    if (!operation) continue;
    pathItem[method] = {
      ...operation,
      parameters: (operation.parameters ?? []).map(parameter => ({
        ...parameter,
        name: parameter.name,
        in: parameter.in,
        required: parameter.required ?? false,
        schema: resolveSchema(parameter.schema, source.source.components ?? {}),
      })),
      ...(operation.requestBody ? {
        requestBody: {
          ...operation.requestBody,
          required: operation.requestBody.required ?? false,
          content: resolveMedia(operation.requestBody.content, source.source.components ?? {}),
        },
      } : {}),
      ...(operation.responses ? {
        responses: Object.fromEntries(Object.entries(operation.responses).map(([status, response]) => [
          status,
          typeof response === 'object' ? {
            ...response,
            ...(response.content ? { content: resolveMedia(response.content, source.source.components ?? {}) } : {}),
          } : response,
        ])),
      } : {}),
    };
  }
  output.paths[path] = pathItem;
}
await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`);
