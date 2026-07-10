import { AppError } from '../middleware/error.middleware';
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'render-api' });
const RENDER_API = 'https://api.render.com/v1';

type EnvGroupRow = { envGroup?: { id?: string; name?: string }; id?: string; name?: string };
type ServiceRow = { service?: { id?: string; name?: string }; id?: string; name?: string };

function apiKey(): string {
  const key = env.RENDER_API_KEY?.trim();
  if (!key) {
    throw new AppError(
      503,
      'RENDER_API_KEY is not configured on the backend',
      'RENDER_NOT_CONFIGURED',
    );
  }
  return key;
}

type RenderFetchInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  okStatuses?: number[];
};

async function renderFetch<T>(path: string, init?: RenderFetchInit): Promise<T> {
  const okStatuses = init?.okStatuses ?? [200, 201];
  const res = await fetch(`${RENDER_API}${path}`, {
    method: init?.method,
    body: init?.body,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!okStatuses.includes(res.status)) {
    log.error('Render API error', undefined, {
      path,
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new AppError(
      502,
      `Render API ${path} failed (${res.status}): ${text.slice(0, 300)}`,
      'RENDER_API_FAILED',
    );
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function asList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: unknown[] }).data;
  }
  return [];
}

const envGroupCache = new Map<string, string>();
const serviceCache = new Map<string, string>();

export async function resolveEnvGroupId(name: string): Promise<string> {
  const cached = envGroupCache.get(name);
  if (cached) return cached;
  const payload = await renderFetch<unknown>(
    `/env-groups?name=${encodeURIComponent(name)}&limit=20`,
  );
  for (const row of asList(payload)) {
    const r = row as EnvGroupRow;
    const eg = r.envGroup ?? r;
    if (eg.name === name && eg.id) {
      envGroupCache.set(name, eg.id);
      return eg.id;
    }
  }
  // Fallback: list all and match (some accounts ignore name filter).
  const all = await renderFetch<unknown>('/env-groups?limit=100');
  for (const row of asList(all)) {
    const r = row as EnvGroupRow;
    const eg = r.envGroup ?? r;
    if (eg.name === name && eg.id) {
      envGroupCache.set(name, eg.id);
      return eg.id;
    }
  }
  throw new AppError(404, `Render env group not found: ${name}`, 'RENDER_ENV_GROUP_MISSING');
}

export async function resolveServiceId(name: string): Promise<string> {
  const cached = serviceCache.get(name);
  if (cached) return cached;
  const payload = await renderFetch<unknown>(`/services?name=${encodeURIComponent(name)}&limit=50`);
  for (const row of asList(payload)) {
    const r = row as ServiceRow;
    const svc = r.service ?? r;
    if (svc.name === name && svc.id) {
      serviceCache.set(name, svc.id);
      return svc.id;
    }
  }
  const all = await renderFetch<unknown>('/services?limit=100');
  for (const row of asList(all)) {
    const r = row as ServiceRow;
    const svc = r.service ?? r;
    if (svc.name === name && svc.id) {
      serviceCache.set(name, svc.id);
      return svc.id;
    }
  }
  throw new AppError(404, `Render service not found: ${name}`, 'RENDER_SERVICE_MISSING');
}

export async function updateEnvGroupSecretFile(
  envGroupName: string,
  secretFileName: string,
  content: string,
): Promise<void> {
  const envGroupId = await resolveEnvGroupId(envGroupName);
  await renderFetch(
    `/env-groups/${envGroupId}/secret-files/${encodeURIComponent(secretFileName)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ content }),
    },
  );
  log.info('Updated Render secret file', { envGroupName, secretFileName, bytes: content.length });
}

/** Redeploy without rebuild so the worker remounts secret files. */
export async function restartRenderService(serviceName: string): Promise<{ deployId: string }> {
  const serviceId = await resolveServiceId(serviceName);
  const deploy = await renderFetch<{ id?: string }>(`/services/${serviceId}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ clearCache: 'do_not_clear', deployMode: 'deploy_only' }),
    okStatuses: [200, 201, 202],
  });
  const deployId = deploy.id ?? 'queued';
  log.info('Triggered Render deploy_only restart', { serviceName, deployId });
  return { deployId };
}

export function isRenderConfigured(): boolean {
  return Boolean(env.RENDER_API_KEY?.trim());
}
