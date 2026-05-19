module.exports = {
  apps: [{
    name: 'notification-worker',
    script: 'notification-worker.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '150M',
    env: {
      NODE_ENV: 'production',
      // Required from runtime environment or .env:
      // DATABASE_URL, RESEND_API_KEY, MAIL_FROM
    },
  }],
};
