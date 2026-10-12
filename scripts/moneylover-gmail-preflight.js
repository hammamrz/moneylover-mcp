// Read-only preflight: no Money Lover writes and no email/transaction details in logs.
import { MoneyloverClient } from '../src/moneyloverClient.js';

const required = ['MONEYLOVER_EMAIL','MONEYLOVER_PASSWORD','GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_REFRESH_TOKEN'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing GitHub Actions secrets: ' + missing.join(', '));
  process.exit(1);
}
const days = 14;
const end = new Date();
const start = new Date(end.getTime() - days * 86400_000);
const date = d => d.toISOString().slice(0,10);
const responseJson = async (res, label) => {
  if (!res.ok) throw new Error(label + ' request failed: HTTP ' + res.status);
  return res.json();
};
const oauth = await responseJson(await fetch('https://oauth2.googleapis.com/token', {
  method:'POST',
  headers: {'content-type':'application/x-www-form-urlencoded'},
  body: new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    grant_type:'refresh_token'
  })
}), 'Gmail OAuth');
if (!oauth.access_token) throw new Error('Gmail OAuth did not return an access token');
const gmailHeaders = { Authorization: 'Bearer ' + oauth.access_token };
const gmail = async (url) => responseJson(await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + url, {headers:gmailHeaders}), 'Gmail');
let nextPageToken, messageCount = 0, pages = 0;
const query = 'after:' + date(start) + ' -in:spam -in:trash {from:(noreply@jago.com) from:(noreply.livin@bankmandiri.co.id) from:(wondr@bni.co.id) from:(no-reply@grab.com) subject:(receipt) subject:(bukti transaksi) subject:(pembayaran berhasil)}';
do {
  const url = new URL('messages', 'https://gmail.googleapis.com/gmail/v1/users/me/');
  url.searchParams.set('q',query);
  url.searchParams.set('maxResults','100');
  if (nextPageToken) url.searchParams.set('pageToken',nextPageToken);
  const page = await gmail('messages?' + url.searchParams.toString());
  messageCount += page.messages?.length ?? 0;
  nextPageToken = page.nextPageToken;
  pages++;
  if (pages >= 100) throw new Error('Gmail message scan exceeds 100 pages; narrow window before continuing');
} while (nextPageToken);
const token = await MoneyloverClient.getToken(process.env.MONEYLOVER_EMAIL,process.env.MONEYLOVER_PASSWORD);
const ml = new MoneyloverClient(token);
const rawWallets = await ml.getWallets();
const wallets = Array.isArray(rawWallets) ? rawWallets : (rawWallets?.wallets ?? rawWallets?.items ?? []);
if (!Array.isArray(wallets) || wallets.length === 0) throw new Error('No Money Lover wallets detected; inspect response shape privately');
let read = 0;
for (const wallet of wallets) {
  const id = wallet._id ?? wallet.id ?? wallet.walletId;
  if (!id) throw new Error('Wallet without recognized ID');
  await ml.getCategories(String(id));
  await ml.getTransactions(String(id),date(start),date(end));
  read++;
}
console.log('READ_ONLY_PREFLIGHT_OK: window=' + date(start) + '..' + date(end) + ', wallets_read=' + read + ', gmail_candidate_messages=' + messageCount);
console.log('No transaction added. No email changed. No sensitive source records printed.');
