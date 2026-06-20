'use strict';

require('dotenv').config();
const { createApp } = require('./src/app');

const port = Number(process.env.PORT || 8080);
const app = createApp();

app.listen(port, () => {
  console.log(`[f16-api] listening on port ${port}`);
});
