const axios = require('axios');
const { Client } = require('pg');
require('dotenv').config({ path: '.env.development' });

// Using development environment credentials from previous context
const API_URL = 'http://localhost:8000/api';
const ADMIN_EMAIL = 'emonline1111@gmail.com';
const ADMIN_PASSWORD = 'emadmin123';

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();

        // 1. Login as Admin
        console.log('Logging in as Admin...');
        const loginRes = await axios.post(`${API_URL}/login`, {
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });
        const adminToken = loginRes.data.token;
        console.log('Admin logged in.');

        // 2. Create a temporary teacher
        const suffix = Date.now();
        const teacherData = {
            name: `Test Teacher ${suffix}`,
            email: `teacher${suffix}@test.com`,
            password: 'password123',
            description: 'Test Desc',
            subject: 'Math'
        };

        console.log('Creating temp teacher...');
        const createRes = await axios.post(`${API_URL}/teacher`, teacherData, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        const teacherId = createRes.data.teacher.id;
        console.log(`Teacher created with ID: ${teacherId}`);

        // 3. Login as the new Teacher
        console.log('Logging in as new Teacher...');
        const teacherLoginRes = await axios.post(`${API_URL}/login`, {
            email: teacherData.email,
            password: teacherData.password
        });
        const teacherToken = teacherLoginRes.data.token;

        // 4. Assign a subject to this teacher (Direct DB)
        // First, find a valid subject ID
        const subRes = await client.query('SELECT id FROM subjects LIMIT 1');
        if (subRes.rows.length === 0) {
            console.error('No subjects found in DB to assign.');
            process.exit(1);
        }
        const subjectId = subRes.rows[0].id;
        console.log(`Assigning subject ID ${subjectId} to teacher...`);

        await client.query(`
      INSERT INTO teacher_subjects (teacher_id, subject_id, assigned_by)
      VALUES ($1, $2, (SELECT id FROM users WHERE email = $3))
      ON CONFLICT (teacher_id, subject_id) DO NOTHING
    `, [teacherId, subjectId, ADMIN_EMAIL]);

        // 5. Test the API
        console.log('Fetching teacher subjects...');
        const res = await axios.get(`${API_URL}/teacher/subjects`, {
            headers: { Authorization: `Bearer ${teacherToken}` }
        });

        console.log('Response data structure sample:', JSON.stringify(res.data.data[0], null, 2));

        const subjects = res.data.data;
        if (!Array.isArray(subjects) || subjects.length === 0) {
            throw new Error('No subjects returned or invalid format');
        }

        const subj = subjects[0];
        if (!subj.chapters || !Array.isArray(subj.chapters)) {
            throw new Error('Subject missing "chapters" array');
        }

        console.log('Verification PASSED: Structure contains nested chapters.');

        // Cleanup
        // await client.query('DELETE FROM users WHERE id = $1', [teacherId]);

    } catch (error) {
        console.error('FAILED:', error.message || error);
        if (error.response) {
            console.error('API Status:', error.response.status);
            console.error('API Response:', error.response.data);
        }
    } finally {
        await client.end();
    }
}

run();
