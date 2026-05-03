const bcrypt = require('bcrypt');
const { Client } = require('pg');
const password = 'Password123!';
const salt = bcrypt.genSaltSync(10);
const hash = bcrypt.hashSync(password, salt);
const client = new Client({ connectionString: 'postgresql://supabase_admin:27jqy5tqxtdl5cfpfi3ust8pn41hbqtch0nmcbpo9s9rpo0087vxulbm6lmp47vx@tramway.proxy.rlwy.net:58446/postgres' });
client.connect().then(() => {
  return client.query('UPDATE auth.users SET encrypted_password = $1 WHERE email = $2 RETURNING *', [hash, 'admin@hierarchia.app']);
}).then(res => {
  console.log('Password updated successfully');
  return client.query('SELECT trigger_name, event_manipulation, event_object_table, action_statement FROM information_schema.triggers WHERE event_object_schema = $1 AND event_object_table = $2', ['auth', 'users']);
}).then(res => {
  console.log(res.rows);
  process.exit();
}).catch(console.error);
