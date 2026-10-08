// Guards `npm run db:reset:demo`, which DROPS EVERY TABLE. It refuses unless the target is clearly a local
// development database, so a stray production DATABASE_URL in the shell cannot be wiped by accident.
require('dotenv').config();
const url = process.env.DATABASE_URL || '';
let host = '';
try {
  host = new URL(url).hostname;
} catch {
  /* unparsable */
}
const local = ['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(host);
if (process.env.NODE_ENV === 'production' || (!local && process.env.ALLOW_DESTRUCTIVE_RESET !== 'yes-wipe-this-database')) {
  console.error(
    `Refusing to reset the database "${host || 'unknown host'}" (NODE_ENV=${process.env.NODE_ENV || 'unset'}).\n` +
      'db:reset:demo erases all data and is for local development only.',
  );
  process.exit(1);
}
