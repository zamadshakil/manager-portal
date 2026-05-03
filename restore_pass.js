const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://supabase_admin:27jqy5tqxtdl5cfpfi3ust8pn41hbqtch0nmcbpo9s9rpo0087vxulbm6lmp47vx@tramway.proxy.rlwy.net:58446/postgres' });
client.connect().then(() => {
  return client.query('UPDATE auth.users SET encrypted_password = $1 WHERE email = $2', [
    '$2a$06$aEJxsYuVeVBHQfsYrV0q5eAg5JyjQmA3KTrarNYAKQe8NQg7X2OE2',
    'admin@hierarchia.app'
  ]);
}).then(() => {
  console.log('Password restored');
  process.exit();
}).catch(console.error);
