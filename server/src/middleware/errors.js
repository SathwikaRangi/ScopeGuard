/* Errors say what happened and what to do about it. No stack traces to the client. */

export function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}.` });
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'That file is larger than 8 MB.' });
  }

  res.status(status).json({
    error: status >= 500 ? 'Something broke on the server. Try again.' : err.message,
  });
}
