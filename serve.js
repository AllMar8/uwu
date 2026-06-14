const http = require('http');
const fs = require('fs');
const path = require('path');
const port = 18888;
const host = '127.0.0.1';
const dir = __dirname;
const srv = http.createServer((req, res) => {
  console.log('Request:', req.url);
  let fp = path.join(dir, req.url === '/' ? 'subtitle_fixer.js' : req.url);
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
  let ext = path.extname(fp);
  let ct = ext === '.js' ? 'text/javascript' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(fp).pipe(res);
});
srv.listen(port, host, () => console.log('Server on http://' + host + ':' + port));
