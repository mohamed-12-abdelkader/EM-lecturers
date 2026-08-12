import bcrypt from 'bcrypt';

const password = process.argv[2] || process.env.FIRST_SUPERUSER_PASSWORD;

if (!password) {
  console.error('Usage: node scripts/hash-superuser-password.mjs <password>');
  console.error('   or: FIRST_SUPERUSER_PASSWORD=secret node scripts/hash-superuser-password.mjs');
  process.exit(1);
}

const hashed = await bcrypt.hash(password, 10);
console.log(hashed);
