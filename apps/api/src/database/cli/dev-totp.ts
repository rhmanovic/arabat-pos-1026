import { totpCode, totpStep } from '../../kernel/crypto/totp.js';
import { DEV_OPERATOR_TOTP_SECRET } from '../seeds/dev-accounts.js';

/** Prints the current TOTP code of the development operator (development only). */
if (process.env['NODE_ENV'] === 'production') {
  console.error('Refusing to run in production.');
  process.exit(1);
}
console.log(totpCode(DEV_OPERATOR_TOTP_SECRET, totpStep()));
