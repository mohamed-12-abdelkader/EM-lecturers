"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrations = applyMigrations;
const node_pg_migrate_1 = require("node-pg-migrate");
const path_1 = __importDefault(require("path"));
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("./pool"));
const bcrypt_1 = __importDefault(require("bcrypt"));
function buildMigrationDbConfig(databaseUrl) {
    const connectionString = databaseUrl.includes('?')
        ? databaseUrl.split('?')[0]
        : databaseUrl;
    return {
        connectionString,
        ssl: { rejectUnauthorized: false },
    };
}
function isDbConnectionError(error) {
    const err = error;
    const message = err?.message || '';
    const code = err?.code || '';
    return (code === 'ENOTFOUND' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNREFUSED' ||
        message.includes('ENOTFOUND') ||
        message.includes('ETIMEDOUT') ||
        message.includes('getaddrinfo') ||
        message.includes('ECONNREFUSED') ||
        message.includes('connect') ||
        message.includes('SELF_SIGNED_CERT'));
}
function logDbConnectionHelp(databaseUrl) {
    console.error('❌ Cannot connect to database. Please check:');
    console.error('  1. Internet connection is active');
    console.error('  2. DATABASE_URL in .env.development is correct');
    console.error('  3. Aiven database service is running (not paused/deleted)');
    console.error('  4. DNS resolves (try: nslookup your-db-host.aivencloud.com)');
    console.error('  5. Firewall/VPN is not blocking outbound port 22237');
    const maskedUrl = databaseUrl?.replace(/:[^:@]+@/, ':****@');
    console.error(`  6. Current DATABASE_URL: ${maskedUrl}`);
}
async function applyMigrations(databaseUrl, direction) {
    const maxAttempts = 3;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await (0, node_pg_migrate_1.runner)({
                count: Number.POSITIVE_INFINITY,
                databaseUrl: buildMigrationDbConfig(databaseUrl),
                dir: path_1.default.resolve(__dirname, '../../migrations'),
                direction,
                migrationsTable: 'migrations',
                verbose: false,
            });
            lastError = undefined;
            break;
        }
        catch (error) {
            lastError = error;
            console.error('Migration error:', error.message);
            if (isDbConnectionError(error)) {
                logDbConnectionHelp(databaseUrl);
                if (attempt < maxAttempts) {
                    console.warn(`⏳ Retrying migrations (${attempt}/${maxAttempts}) in 2s...`);
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    continue;
                }
            }
            throw error;
        }
    }
    if (lastError)
        throw lastError;
    if (direction !== 'up')
        return;
    const { FIRST_SUPERUSER, FIRST_SUPERUSER_PASSWORD } = utils_1.config;
    if (!FIRST_SUPERUSER || !FIRST_SUPERUSER_PASSWORD)
        return;
    const exists = await pool_1.default.query(`SELECT u.id FROM users u
     JOIN tenants t ON t.id = u.tenant_id AND t.subdomain = 'default'
     WHERE u.email = $1 OR u.phone = $1`, [FIRST_SUPERUSER]);
    if (exists.rowCount === 0) {
        const hashed = await bcrypt_1.default.hash(FIRST_SUPERUSER_PASSWORD, 10);
        await pool_1.default.query(`INSERT INTO users (email, phone, password, name, role, tenant_id)
       SELECT
         $1,
         CASE WHEN POSITION('@' IN $1) = 0 THEN $1 ELSE NULL END,
         $2,
         $1,
         'admin',
         t.id
       FROM tenants t WHERE t.subdomain = 'default' LIMIT 1`, [FIRST_SUPERUSER, hashed]);
        console.log('✅ First superuser created.');
    }
    else {
        console.log('ℹ️  First superuser already exists.');
    }
}
