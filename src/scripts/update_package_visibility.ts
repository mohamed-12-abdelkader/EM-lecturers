import pool from '../db/pool';

async function updateVisibilityColumns() {
    console.log('Adding visibility columns...');
    try {
        await pool.query(`
      ALTER TABLE package_subject_lessons 
      ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT FALSE;
    `);

        await pool.query(`
      ALTER TABLE package_subject_assignments 
      ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT FALSE;
    `);

        console.log('Columns added successfully');
    } catch (error) {
        console.error('Error adding columns:', error);
    } finally {
        process.exit();
    }
}

updateVisibilityColumns();
