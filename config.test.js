module.exports = {
  NODE_ENV: 'development',
  CORS_ORIGIN: 'http://localhost:3000',
  FRONTEND_HOST: 'http://localhost:3000',
  SECRET_KEY: 'test-secret-key-for-development-only',
  DATABASE_URL: 'postgresql://postgres:password@localhost:5432/emonline_test',
  DATABASE_SSL: false,
  FIRST_SUPERUSER: 'admin@example.com',
  FIRST_SUPERUSER_PASSWORD: 'admin123',
};
