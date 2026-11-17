// Loads server/.env, then server/src/.env, independent of the working directory.
// Real environment variables win; a later file only fills keys that no earlier source defined
// (a key set to empty in server/.env, e.g. a blank local DB_PASSWORD, counts as defined).
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

for (const file of [path.join(__dirname, '..', '.env'), path.join(__dirname, '.env')]) {
  if (!fs.existsSync(file)) continue;
  const vars = dotenv.parse(fs.readFileSync(file));
  for (const [k, v] of Object.entries(vars)) if (process.env[k] === undefined) process.env[k] = v;
}
