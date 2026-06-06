const { Client } = require('pg');
require('dotenv').config({ path: '.env.development' });

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('Connected to DB.');

        const res = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'lessons'
    `);

        console.log('Columns in lessons table:');
        res.rows.forEach(r => console.log(`- ${r.column_name}`));

        const resChapters = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'chapters'
    `);
        console.log('\nColumns in chapters table:');
        resChapters.rows.forEach(r => console.log(`- ${r.column_name}`));

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

run();
