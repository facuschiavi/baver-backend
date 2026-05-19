module.exports = {
  apps: [{
    name: 'baver-backend',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 4100,
      DATABASE_URL: 'postgresql://cristal:cristal123@localhost:5432/baver_retail',
      JWT_SECRET: 'baver-secret-change-in-production',
      SIM_PORT: '4104',
      GW_PORT: '18791',
      GW_CONFIG_PATH: '/root/.openclaw-vib3-baver/openclaw.json',
      GW_AGENT_ID: 'castorcito',
      GW_SIM_AGENT_ID: 'castorcito-sim',
      SIM_DB: 'baver_sim',
      SOURCE_DB: 'baver_retail'
    }
  }]
};
