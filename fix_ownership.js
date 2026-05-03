const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://supabase_admin:27jqy5tqxtdl5cfpfi3ust8pn41hbqtch0nmcbpo9s9rpo0087vxulbm6lmp47vx@tramway.proxy.rlwy.net:58446/postgres' });
client.connect().then(async () => {
  const tables = [
    'custom_oauth_providers', 'audit_log_entries', 'oauth_client_states',
    'oauth_clients', 'oauth_consents', 'webauthn_credentials',
    'webauthn_challenges', 'oauth_authorizations'
  ];
  for (const table of tables) {
    await client.query(`ALTER TABLE auth.${table} OWNER TO supabase_auth_admin`);
  }
  console.log('Ownership updated');
  process.exit();
}).catch(console.error);
