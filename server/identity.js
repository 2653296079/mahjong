'use strict';
const crypto = require('node:crypto');
function visitorId(req) {
  const match = /(?:^|;\s*)zmj_visitor=([a-f0-9]{32})(?:;|$)/.exec(req.headers.cookie || '');
  return match ? match[1] : null;
}
function identity(req, user) {
  const visitor = visitorId(req) || crypto.randomBytes(16).toString('hex');
  return { key:user ? 'account:' + user.id : 'visitor:' + visitor,
    name:user ? user.name : '访客·' + visitor.slice(0,8).toUpperCase(), kind:user ? 'account' : 'visitor', visitor };
}
function publicIdentity(value) { return { name:value.name, kind:value.kind }; }
function visitorCookie(req, value) {
  const secure = req.socket.encrypted || /^https:\/\//.test(req.headers.origin || '');
  return 'zmj_visitor=' + value.visitor + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000' + (secure ? '; Secure' : '');
}
module.exports = {visitorId, identity, publicIdentity, visitorCookie};
