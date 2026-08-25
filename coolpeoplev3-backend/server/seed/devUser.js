#!/usr/bin/env node
/*
 * DEV-ONLY: create a single dev user to bootstrap a super_admin against.
 * Minimal direct insert (just the users NOT-NULL columns) — no consent/child-
 * safety records, since this is a dev admin account, not a real signup.
 * Idempotent on email. Own pg connection (does not boot Express).
 */
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');

const EMAIL = 'dev-admin@coolpeople.dev';
const PASSWORD = 'DevAdmin!2026';

(async () => {
    const c = new Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
    await c.connect();
    try {
        const existing = await c.query('SELECT id, email, username FROM users WHERE LOWER(email) = LOWER($1)', [EMAIL]);
        if (existing.rows.length) {
            console.log('✓ dev user already exists:', existing.rows[0]);
            return;
        }
        const hash = await bcrypt.hash(PASSWORD, 10);
        const r = await c.query(
            `INSERT INTO users (first_name, last_name, username, date_of_birth, password, email)
             VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING id, email, username`,
            ['Dev', 'Admin', 'devadmin', '1990-01-01', hash, EMAIL]
        );
        console.log('✓ created dev user:', r.rows[0]);
        console.log(`  login → username: devadmin | password: ${PASSWORD}`);
    } finally {
        await c.end();
    }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
