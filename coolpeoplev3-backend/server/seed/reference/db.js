/*
 * Reference-seed DB connection — DELIBERATELY SEPARATE from server/DB/index.js.
 *
 * Why its own connection: server/DB/index.js calls init() at import time, which
 * connects the shared client AND starts the Express server (app.listen). A seed
 * CLI must not boot the server, so we open our own short-lived Pool here. It
 * reads the same PG* env vars from .env (PGUSER/PGHOST/PGDATABASE/PGPORT/...),
 * so no extra config is needed.
 */
require('dotenv').config();
const { Pool } = require('pg');

// No connectionString → node-postgres falls back to the standard PG* env vars,
// which is exactly how the server connects today.
const pool = new Pool(
    process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}
);

// One-shot query.
const query = (text, params) => pool.query(text, params);

/*
 * Run `fn(client)` inside a transaction. Every source run should wrap its writes
 * so a mid-run failure rolls back cleanly and a re-run starts from a clean slate.
 */
const withTransaction = async (fn) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const close = () => pool.end();

module.exports = { pool, query, withTransaction, close };
