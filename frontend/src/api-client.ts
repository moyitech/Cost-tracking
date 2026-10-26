// Transport-independent authentication, used by Taro and integration tests.
export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
export type Session = { access_token: string; refresh_token: string; user: { id: string; display_name: string } }
export type Transport = (path: string, method: Method, data?: unknown, headers?: Record<string, string>) => Promise<{ status: number; data: any }>
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
export function createApiClient(transport: Transport, read: () => Session | null, save: (session: Session | null) => void, login: () => Promise<Session>) {
  let authenticating: Promise<Session> | null = null
  const authenticate = (force = false) => {
    if (authenticating) return authenticating
    const current = read()
    if (current && !force) return Promise.resolve(current)
    authenticating = (async () => {
      if (current?.refresh_token) {
        const result = await transport('/auth/refresh', 'POST', { refresh_token: current.refresh_token })
        if (result.status === 200) { save(result.data); return result.data as Session }
        if (result.status !== 401) throw failure(result)
        save(null)
      }
      const next = await login(); save(next); return next
    })().finally(() => { authenticating = null })
    return authenticating
  }
  return {
    async request<T>(path: string, method: Method = 'GET', data?: unknown, headers: Record<string, string> = {}): Promise<T> {
      let session = await authenticate()
      let result = await transport(path, method, data, { ...headers, Authorization: `Bearer ${session.access_token}` })
      if (result.status === 401) {
        const latest = read()
        session = latest && latest.access_token !== session.access_token ? latest : await authenticate(true)
        result = await transport(path, method, data, { ...headers, Authorization: `Bearer ${session.access_token}` })
      }
      if (result.status < 200 || result.status >= 300) throw failure(result)
      return result.data as T
    },
    authenticate,
  }
}
export function failure(result: { status: number; data: any }) {
  const error = result.data?.error
  const message = result.status === 409 && ['REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(error?.code) ? `${error?.message || '档案已被其他操作更新'}；输入已保留，请核对后再保存`
    : result.status === 403 ? `${error?.message || '权限已变化，无法操作'}；输入已保留`
      : error?.message || '服务暂时不可用，输入已保留，请重试'
  return new ApiError(result.status, error?.code || 'REQUEST_FAILED', message)
}
