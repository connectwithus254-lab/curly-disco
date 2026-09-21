import Fastify from 'fastify';
import cookie from '@fastify/cookie';

const app = Fastify({ logger: false });
await app.register(cookie);
app.addHook('onRequest', async (request, reply) => {
  console.log('HOOK RAN', request.url, 'cookie header:', request.headers.cookie);
  reply.setCookie('bs_csrf', 'abc123', { path: '/', httpOnly: false, sameSite: 'lax' });
});
app.get('/x', async (_req, reply) => reply.send({ ok: true }));
const res = await app.inject({ method: 'GET', url: '/x' });
console.log('set-cookie:', JSON.stringify(res.headers['set-cookie']));
await app.close();
