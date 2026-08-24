#!/usr/bin/env node
/**
 * Wipe WhatsApp bot chat history for a phone so the next inbound
 * message starts a fresh conversation (no LLM history).
 *
 * Usage (from ~/EM-lecturers on the server):
 *   node scripts/wipe-wa-chat.mjs 01156087071
 *   node scripts/wipe-wa-chat.mjs 201156087071 --dry-run
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, '.env.development'));

function normalizePhone(phone) {
  let digits = String(phone || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (
    digits.startsWith('966') ||
    digits.startsWith('20') ||
    digits.startsWith('971') ||
    digits.startsWith('973') ||
    digits.startsWith('965') ||
    digits.startsWith('974')
  ) {
    return digits;
  }

  if (digits.startsWith('05') && digits.length === 10) return `966${digits.slice(1)}`;
  if (digits.startsWith('5') && digits.length === 9) return `966${digits}`;
  if (digits.startsWith('01') && digits.length === 11) return `20${digits.slice(1)}`;
  if (/^1[0125]\d{8}$/.test(digits)) return `20${digits}`;
  return digits;
}

function phoneVariants(phone) {
  const n = normalizePhone(phone);
  const set = new Set([n, String(phone).replace(/[^0-9]/g, '')].filter(Boolean));
  if (n.startsWith('20') && n.length >= 12) {
    const local = n.slice(2);
    set.add(`0${local}`);
    set.add(local);
  }
  if (n.startsWith('0') && n.length >= 10) set.add(normalizePhone(n));
  return [...set];
}

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const dryRun = process.argv.includes('--dry-run');
const phoneArg = args[0] || '01156087071';
const variants = phoneVariants(phoneArg);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (load from .env)');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

async function main() {
  console.log(`Phone: ${phoneArg}`);
  console.log(`Variants: ${variants.join(', ')}`);
  if (dryRun) console.log('Mode: DRY RUN (no deletes)');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const convos = await client.query(
      `SELECT id, session_slug, contact_phone, status, last_message_at
       FROM wa_conversations
       WHERE contact_phone = ANY($1::text[])
       ORDER BY id`,
      [variants],
    );
    const conversationIds = convos.rows.map((r) => r.id);

    const inboundCount = await client.query(
      `SELECT COUNT(*)::int AS n FROM wa_inbound_events
       WHERE from_phone = ANY($1::text[])
          OR ($2::int[] IS NOT NULL AND conversation_id = ANY($2::int[]))`,
      [variants, conversationIds.length ? conversationIds : null],
    );
    const outboundCount = await client.query(
      `SELECT COUNT(*)::int AS n FROM wa_outbound_jobs
       WHERE to_phone = ANY($1::text[])
          OR ($2::int[] IS NOT NULL AND conversation_id = ANY($2::int[]))`,
      [variants, conversationIds.length ? conversationIds : null],
    );
    const auditCount = await client.query(
      `SELECT COUNT(*)::int AS n FROM wa_support_audit
       WHERE contact_phone = ANY($1::text[])
          OR ($2::int[] IS NOT NULL AND conversation_id = ANY($2::int[]))`,
      [variants, conversationIds.length ? conversationIds : null],
    );

    console.log(`Conversations: ${convos.rowCount}`);
    for (const row of convos.rows) {
      console.log(
        `  #${row.id} ${row.contact_phone} status=${row.status} session=${row.session_slug} last=${row.last_message_at?.toISOString?.() || row.last_message_at}`,
      );
    }
    console.log(`Inbound events: ${inboundCount.rows[0].n}`);
    console.log(`Outbound jobs:  ${outboundCount.rows[0].n}`);
    console.log(`Support audit:  ${auditCount.rows[0].n}`);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Dry run complete — nothing deleted.');
      return;
    }

    const delAudit = await client.query(
      `DELETE FROM wa_support_audit
       WHERE contact_phone = ANY($1::text[])
          OR ($2::int[] IS NOT NULL AND conversation_id = ANY($2::int[]))`,
      [variants, conversationIds.length ? conversationIds : null],
    );
    const delInbound = await client.query(
      `DELETE FROM wa_inbound_events
       WHERE from_phone = ANY($1::text[])
          OR ($2::int[] IS NOT NULL AND conversation_id = ANY($2::int[]))`,
      [variants, conversationIds.length ? conversationIds : null],
    );
    const delOutbound = await client.query(
      `DELETE FROM wa_outbound_jobs
       WHERE to_phone = ANY($1::text[])
          OR ($2::int[] IS NOT NULL AND conversation_id = ANY($2::int[]))`,
      [variants, conversationIds.length ? conversationIds : null],
    );
    const delConvos = await client.query(
      `DELETE FROM wa_conversations WHERE contact_phone = ANY($1::text[])`,
      [variants],
    );

    await client.query('COMMIT');

    console.log('Deleted:');
    console.log(`  audit=${delAudit.rowCount}`);
    console.log(`  inbound=${delInbound.rowCount}`);
    console.log(`  outbound=${delOutbound.rowCount}`);
    console.log(`  conversations=${delConvos.rowCount}`);
    console.log('Done. Next WhatsApp message from this number will start a fresh bot chat.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
