// Thin wrapper around fetch for the Smart Storage Locker backend.
// All endpoints are relative, same as the original static HTML pages,
// so configure a dev-server proxy (see vite.config.js) or serve this
// build from the same origin as the API in production.

async function request(path, options = {}) {
  const res = await fetch(path, options);
  return res;
}

export async function getJSON(path) {
  const res = await request(path);
  return res.json();
}

export async function postJSON(path, body) {
  const res = await request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

export async function putJSON(path, body) {
  const res = await request(path, {
    method: 'PUT',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

export { request };
