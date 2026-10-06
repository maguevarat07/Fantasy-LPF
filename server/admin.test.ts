import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { generate } from 'otplib';
import { createApp } from './app.js';
import { openDatabase, type SqliteDatabase } from './db.js';

const origin = { Host: 'qa.test', Origin: 'http://qa.test' };
let db: SqliteDatabase;
beforeEach(() => {
  vi.stubEnv('ADMIN_MFA_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'));
  db = openDatabase({ filename: ':memory:' });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

describe('administrative isolation', () => {
  it('denies anonymous, normal user, role tampering, and requests without CSRF origin', async () => {
    const app = createApp({ db, secureCookies: false });
    await request(app).get('/api/admin/overview').expect(401);
    const user = request.agent(app);
    const registered = await user.post('/api/auth/register').send({
      email:'normal@example.com',username:'normal',password:'correct horse battery staple',managerName:'Normal User'
    }).expect(201);
    await user.get('/api/admin/overview').expect(403);
    await user.get('/api/admin/state').expect(403);
    await user.post('/api/admin/mfa/setup').set(origin).send({password:'correct horse battery staple'}).expect(403);
    await user.patch('/api/profile').send({managerName:'ADMIN',role:'ADMIN'}).expect(400);
    expect(db.prepare('SELECT role FROM admin_user_roles WHERE user_id=?').get(registered.body.user.id)).toBeUndefined();
    db.prepare('INSERT INTO admin_user_roles(user_id,role,granted_at) VALUES(?,?,?)')
      .run(registered.body.user.id,'ADMIN',new Date().toISOString());
    await user.get('/api/admin/overview').expect(403);
    await user.post('/api/admin/mfa/setup').send({password:'correct horse battery staple'}).expect(403);
  });

  it('requires MFA, prevents TOTP replay, and revokes access after logout', async () => {
    const app = createApp({ db, secureCookies: false });
    const admin = request.agent(app);
    const registered = await admin.post('/api/auth/register').send({
      email:'admin@example.com',username:'qa_admin',password:'correct horse battery staple',managerName:'QA Admin'
    }).expect(201);
    db.prepare('INSERT INTO admin_user_roles(user_id,role,granted_at) VALUES(?,?,?)')
      .run(registered.body.user.id,'ADMIN',new Date().toISOString());
    await admin.get('/api/admin/overview').expect(403);
    const setup = await admin.post('/api/admin/mfa/setup').set(origin)
      .send({password:'correct horse battery staple'}).expect(200);
    expect(setup.body.uri).toContain('otpauth://');
    const code = await generate({secret:setup.body.secret});
    await admin.post('/api/admin/mfa/confirm').set(origin).send({code}).expect(200);
    await admin.get('/api/admin/overview').expect(200);
    const users = await admin.get('/api/admin/users?search=admin&filter=active&sort=name').expect(200);
    expect(users.body.users).toHaveLength(1);
    await admin.get(`/api/admin/users/${registered.body.user.id}`).expect(200);
    await admin.get(`/api/admin/users/${registered.body.user.id}/team`).expect(200);
    await admin.get('/api/admin/system/status').expect(200);
    await admin.get('/api/admin/users?sort=password_hash').expect(400);
    await admin.get('/api/admin/users/not-an-id').expect(400);
    await admin.post('/api/admin/mfa/verify').set(origin).send({code}).expect(403);
    await admin.post('/api/admin/logout').set(origin).expect(204);
    await admin.get('/api/admin/overview').expect(403);
    await admin.post('/api/auth/logout').expect(204);
    await admin.get('/api/admin/state').expect(401);
  });
});
