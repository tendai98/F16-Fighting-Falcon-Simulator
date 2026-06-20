# Express Catch-All Route Fix

The backend no longer uses `app.get('*', ...)` for SPA fallback serving.

Express 5 uses a newer `path-to-regexp` parser where bare `*` routes throw:

```text
Missing parameter name at index 1: *
```

The SPA fallback is now implemented with a no-path middleware:

```js
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(clientRoot, 'index.html'));
});
```

This is compatible with both Express 4 and Express 5.
