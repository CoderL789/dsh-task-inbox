/**
 * The plugin's single HTTP bridge: same-origin JSON API used by the Client
 * half, authenticated through the DSH Connection service.
 *
 * The route is registered with `ctx.webServer.register` and each request is
 * checked with `ctx.connection.requestRejection` (Host/Origin trust plus the
 * signed browser cookie), so the endpoint is not reachable anonymously.
 * Business errors are returned as `{ ok: false }` envelopes with HTTP 200; the
 * Client renders them as failures and never as success.
 */
import { TodoServiceError, } from './service.js';
export const API_PATH = '/plugins/dsh-task-inbox/api';
export const MAX_BODY_BYTES = 256 * 1024;
function failure(code, message) {
    return { status: 200, body: { ok: false, error: { code, message } } };
}
function success(data) {
    return { status: 200, body: { ok: true, data } };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readId(record) {
    const id = record.id;
    if (typeof id !== 'string')
        return undefined;
    if (id.length === 0 || id.length > 128)
        return undefined;
    return id;
}
/** Validate the envelope envelope shape and operation fields. */
export function parseApiPayload(payload) {
    if (!isRecord(payload)) {
        return { ok: false, code: 'invalid_payload', message: 'Request body must be a JSON object.' };
    }
    const op = payload.op;
    if (typeof op !== 'string') {
        return { ok: false, code: 'invalid_payload', message: 'Request is missing an operation.' };
    }
    switch (op) {
        case 'list':
            return { ok: true, operation: { op } };
        case 'create':
            return {
                ok: true,
                operation: {
                    op,
                    title: payload.title,
                    description: payload.description,
                    requestId: payload.requestId,
                },
            };
        case 'update': {
            const id = readId(payload);
            if (id === undefined) {
                return { ok: false, code: 'invalid_payload', message: 'Update requires a task id.' };
            }
            return {
                ok: true,
                operation: {
                    op,
                    id,
                    title: payload.title,
                    description: payload.description,
                    requestId: payload.requestId,
                },
            };
        }
        case 'delete': {
            const id = readId(payload);
            if (id === undefined) {
                return { ok: false, code: 'invalid_payload', message: 'Delete requires a task id.' };
            }
            return { ok: true, operation: { op, id } };
        }
        case 'move': {
            const id = readId(payload);
            if (id === undefined) {
                return { ok: false, code: 'invalid_payload', message: 'Move requires a task id.' };
            }
            const direction = payload.direction;
            if (direction !== 'up' && direction !== 'down') {
                return {
                    ok: false,
                    code: 'invalid_payload',
                    message: 'Move direction must be "up" or "down".',
                };
            }
            return { ok: true, operation: { op, id, direction } };
        }
        default:
            return { ok: false, code: 'invalid_payload', message: `Unknown operation: ${op}` };
    }
}
/** Execute one validated operation against the CRUD service. */
export async function handleOperation(service, operation) {
    try {
        switch (operation.op) {
            case 'list':
                return success({ todos: service.list() });
            case 'create': {
                const todo = await service.create({
                    title: operation.title,
                    description: operation.description,
                    requestId: operation.requestId,
                });
                return success({ todo });
            }
            case 'update': {
                const todo = await service.update({
                    id: operation.id,
                    title: operation.title,
                    description: operation.description,
                    requestId: operation.requestId,
                });
                return success({ todo });
            }
            case 'delete': {
                const deleted = await service.delete(operation.id);
                return success({ deleted });
            }
            case 'move': {
                const todos = await service.move(operation.id, operation.direction);
                return success({ todos });
            }
        }
    }
    catch (error) {
        if (error instanceof TodoServiceError) {
            return failure(error.code, error.message);
        }
        return {
            status: 500,
            body: { ok: false, error: { code: 'internal_error', message: 'Unexpected Task Inbox error.' } },
        };
    }
}
class BodyTooLargeError extends Error {
}
const BYTE_ENCODER = new TextEncoder();
function chunkBytes(chunk) {
    if (typeof chunk === 'string')
        return BYTE_ENCODER.encode(chunk);
    if (chunk instanceof Uint8Array)
        return chunk;
    if (ArrayBuffer.isView(chunk)) {
        return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    if (chunk instanceof ArrayBuffer)
        return new Uint8Array(chunk);
    return BYTE_ENCODER.encode(String(chunk));
}
/**
 * Read the request body as UTF-8 with an accurate BYTE limit.
 *
 * - The limit counts real bytes (`byteLength`), not JavaScript string length,
 *   so multi-byte content cannot bypass it.
 * - A streaming `TextDecoder` keeps code points intact when a request chunk
 *   splits a multi-byte UTF-8 sequence across `data` events.
 * - On overflow the request is destroyed (when the runtime supports it) so the
 *   remaining payload is not read into memory.
 */
function readBody(request) {
    return new Promise((resolve, reject) => {
        const decoder = new TextDecoder('utf-8');
        const parts = [];
        let bytes = 0;
        let settled = false;
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            reject(error);
            request.destroy?.();
        };
        request.on('data', (...args) => {
            if (settled)
                return;
            const chunk = chunkBytes(args[0]);
            bytes += chunk.byteLength;
            if (bytes > MAX_BODY_BYTES) {
                fail(new BodyTooLargeError('Request body is too large.'));
                return;
            }
            parts.push(decoder.decode(chunk, { stream: true }));
        });
        request.on('end', () => {
            if (settled)
                return;
            settled = true;
            parts.push(decoder.decode());
            resolve(parts.join(''));
        });
        request.on('error', (error) => fail(error));
    });
}
function sendJson(response, status, body) {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
    });
    response.end(JSON.stringify(body));
}
/** Build the Node handler registered for the plugin's API route. */
export function createApiHandler(options) {
    return async function handle(request, response) {
        const path = String(request.url ?? '').split('?')[0];
        if (path !== API_PATH) {
            sendJson(response, 404, { ok: false, error: { code: 'not_found', message: 'Unknown endpoint.' } });
            return;
        }
        if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' });
            response.end();
            return;
        }
        let rejection;
        try {
            rejection = options.authorize(request.headers);
        }
        catch {
            rejection = 401;
        }
        if (rejection !== undefined) {
            sendJson(response, rejection, {
                ok: false,
                error: { code: 'unauthorized', message: 'Authentication required.' },
            });
            return;
        }
        try {
            const raw = await readBody(request);
            let payload;
            try {
                payload = JSON.parse(raw);
            }
            catch {
                sendJson(response, 400, {
                    ok: false,
                    error: { code: 'invalid_payload', message: 'Request body must be valid JSON.' },
                });
                return;
            }
            const parsed = parseApiPayload(payload);
            if (!parsed.ok) {
                sendJson(response, 400, {
                    ok: false,
                    error: { code: parsed.code, message: parsed.message },
                });
                return;
            }
            const result = await handleOperation(options.service, parsed.operation);
            sendJson(response, result.status, result.body);
        }
        catch (error) {
            if (error instanceof BodyTooLargeError) {
                sendJson(response, 413, {
                    ok: false,
                    error: { code: 'invalid_payload', message: error.message },
                });
                return;
            }
            sendJson(response, 500, {
                ok: false,
                error: { code: 'internal_error', message: 'Unexpected Task Inbox error.' },
            });
        }
    };
}
