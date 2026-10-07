import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.test') });

// End-to-end suites log in many times from one address; the production default (10/min) would 429 them.
process.env.AUTH_THROTTLE_LIMIT ??= '10000';
