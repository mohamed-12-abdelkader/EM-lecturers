const jwt = require('jsonwebtoken');

// إنشاء token للاختبار - Admin
const adminUser = {
  id: 1,
  email: 'admin@example.com',
  role: 'admin',
  jti: 'test-jti',
};

// إنشاء token للاختبار - Student
const studentUser = {
  id: 5,
  email: 'student@example.com',
  role: 'student',
  jti: 'test-student-jti',
};

const secretKey = 'test-secret-key-for-development-only';

const adminToken = jwt.sign(adminUser, secretKey, { expiresIn: '7d' });
const studentToken = jwt.sign(studentUser, secretKey, { expiresIn: '7d' });

console.log('Admin Token:', adminToken);
console.log('Student Token:', studentToken);
console.log('Admin User:', adminUser);
console.log('Student User:', studentUser);

// اختبار فك التشفير
try {
  const decodedAdmin = jwt.verify(adminToken, secretKey);
  const decodedStudent = jwt.verify(studentToken, secretKey);
  console.log('Decoded Admin Token:', decodedAdmin);
  console.log('Decoded Student Token:', decodedStudent);
} catch (error) {
  console.error('Token verification error:', error);
}
