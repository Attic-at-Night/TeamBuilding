const express = require('express');
const app = express();
app.get('/headers', (req, res) => res.json(req.headers));
app.listen(3001, () => console.log('Listening'));
