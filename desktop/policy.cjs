'use strict';
const DASHBOARD_ORIGIN = 'https://dev-jarvis.eliadablah.com';
const DASHBOARD_URL = `${DASHBOARD_ORIGIN}/?design=auto`;
function trustedPage(value) {
  try { const u = new URL(value); return u.origin === DASHBOARD_ORIGIN && !u.username && !u.password; }
  catch { return false; }
}
function externalPage(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; }
  catch { return false; }
}
function trustedSender(event, contents) {
  return event.sender === contents && event.senderFrame === contents.mainFrame && trustedPage(event.senderFrame.url);
}
module.exports = { DASHBOARD_ORIGIN, DASHBOARD_URL, trustedPage, externalPage, trustedSender };
