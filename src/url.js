function getJoinRedirectLocation(originalUrl) {
  const queryIndex = String(originalUrl || '').indexOf('?');
  const query = queryIndex >= 0 ? String(originalUrl).slice(queryIndex) : '';
  return `/join.html${query}`;
}

module.exports = {
  getJoinRedirectLocation,
};
