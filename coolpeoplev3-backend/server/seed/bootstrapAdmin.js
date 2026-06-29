#!/usr/bin/env node
/*
 * bootstrapAdmin.js — mint the FIRST super_admin.
 *
 * WHY A CLI, NOT A ROUTE: every admin-management route is gated by
 * requireAdmin('super_admin'), so the very first admin is a chicken-and-egg
 * problem. Solving it with an HTTP endpoint would create a permanent
 * privilege-escalation surface. Instead this runs out-of-band: it needs direct
 * DB access (the same credentials your server uses), has no network surface, and
 * refuses to run once an active super_admin already exists (unless --force).
 *
 * It opens its OWN pg connection (like server/seed/reference/db.js) so it never
 * imports server/DB/index.js — i.e. it does not boot Express.
 *
 * Usage:
 *   node server/seed/bootstrapAdmin.js --email you@example.com
 *   node server/seed/bootstrapAdmin.js --username myhandle --role super_admin
 *   node server/seed/bootstrapAdmin.js --user-id <uuid> --reason "initial setup"
 *   node server/seed/bootstrapAdmin.js --email you@example.com --force   # even if a super_admin exists
 *
 * NOTE ON MFA: real TOTP MFA is a planned follow-up. Today requireMFAFresh only
 * checks the mfa_enabled flag, so this bootstraps the admin with mfa_enabled=true
 * so they can immediately use the MFA-gated admin routes. Re-run with the real
 * MFA enrollment flow once it lands.
 */
require("dotenv").config();
const { Client } = require("pg");

const VALID_ROLES = ["super_admin", "moderator", "support", "finance", "engineer", "read_only"];

function parseArgs(argv) {
    const a = { role: "super_admin", reason: "initial admin bootstrap via CLI" };
    for (let i = 2; i < argv.length; i++) {
        const k = argv[i];
        if (k === "--force") a.force = true;
        else if (k === "--email") a.email = argv[++i];
        else if (k === "--username") a.username = argv[++i];
        else if (k === "--user-id") a.userId = argv[++i];
        else if (k === "--role") a.role = argv[++i];
        else if (k === "--reason") a.reason = argv[++i];
    }
    return a;
}

async function resolveUser(client, a) {
    if (a.userId) {
        const { rows } = await client.query(`SELECT id, username, email FROM users WHERE id = $1`, [a.userId]);
        return rows[0];
    }
    if (a.email) {
        const { rows } = await client.query(`SELECT id, username, email FROM users WHERE LOWER(email) = LOWER($1)`, [a.email]);
        return rows[0];
    }
    if (a.username) {
        const { rows } = await client.query(`SELECT id, username, email FROM users WHERE username = $1`, [a.username]);
        return rows[0];
    }
    return null;
}

async function main() {
    const a = parseArgs(process.argv);

    if (!a.email && !a.username && !a.userId) {
        console.error("Identify the target user with --email, --username, or --user-id.");
        process.exit(1);
    }
    if (!VALID_ROLES.includes(a.role)) {
        console.error(`--role must be one of: ${VALID_ROLES.join(", ")}`);
        process.exit(1);
    }

    const client = new Client(
        process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}
    );
    await client.connect();

    try {
        await client.query("BEGIN");

        const user = await resolveUser(client, a);
        if (!user) {
            throw new Error("no user matched that --email / --username / --user-id");
        }

        // refuse to create a second super_admin unless explicitly forced
        if (a.role === "super_admin" && !a.force) {
            const { rows } = await client.query(
                `SELECT count(*)::int AS n FROM admin_users
                 WHERE role = 'super_admin' AND status = 'active' AND terminated_at IS NULL`
            );
            if (rows[0].n > 0) {
                throw new Error(
                    `an active super_admin already exists (${rows[0].n}). ` +
                        "Use the admin API to add more, or pass --force to override."
                );
            }
        }

        // one admin row per user
        const existing = await client.query(`SELECT id, role, status FROM admin_users WHERE user_id = $1`, [user.id]);
        if (existing.rows.length) {
            throw new Error(
                `user already has an admin record (id=${existing.rows[0].id}, role=${existing.rows[0].role}, status=${existing.rows[0].status}).`
            );
        }

        const ins = await client.query(
            `INSERT INTO admin_users (user_id, role, status, mfa_enabled)
             VALUES ($1, $2, 'active', true)
             RETURNING id, user_id, role, status, mfa_enabled, created_at`,
            [user.id, a.role]
        );
        const admin = ins.rows[0];

        // self-referential audit row: the bootstrap admin is its own actor.
        await client.query(
            `INSERT INTO admin_actions
               (admin_user_id, action_type, target_resource_type, target_resource_id,
                after_state, reason, mfa_verified)
             VALUES ($1, 'admin.bootstrap', 'admin_user', $1, $2, $3, false)`,
            [admin.id, JSON.stringify(admin), a.reason]
        );

        await client.query("COMMIT");
        console.log("✓ super_admin bootstrapped:");
        console.log(`   admin_id : ${admin.id}`);
        console.log(`   user     : ${user.username} <${user.email}>  (${admin.user_id})`);
        console.log(`   role     : ${admin.role}   mfa_enabled: ${admin.mfa_enabled}`);
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`✗ bootstrap failed: ${err.message}`);
        process.exitCode = 1;
    } finally {
        await client.end();
    }
}

main();
