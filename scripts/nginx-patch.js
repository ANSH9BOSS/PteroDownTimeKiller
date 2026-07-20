const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../src/logger');

const CONFIG_PATHS = [
  '/etc/nginx/sites-available/pterodactyl.conf',
  '/etc/nginx/sites-enabled/pterodactyl.conf',
  '/etc/nginx/conf.d/pterodactyl.conf',
  '/home/ubuntu/pterodactyl.conf' // fallback for dev environment
];

function patchNginx() {
  let patched = false;

  for (const configPath of CONFIG_PATHS) {
    if (!fs.existsSync(configPath)) continue;

    let content = fs.readFileSync(configPath, 'utf8');

    // Check if proxy location block is already present
    if (content.includes('location /api/sync/')) {
      logger.info(`Nginx proxy location block already exists in ${configPath}`);
      return true;
    }

    // Find the server block containing /var/www/pterodactyl/public
    const serverBlockRegex = /server\s*{[^}]+root\s+\/var\/www\/pterodactyl\/public[^}]+}/g;
    const match = content.match(serverBlockRegex);

    if (match) {
      const serverBlock = match[0];
      const proxyBlock = `
    location /api/sync/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
`;
      // Insert the proxy block before the closing brace of the matched server block
      const lastBraceIndex = serverBlock.lastIndexOf('}');
      const patchedServerBlock = serverBlock.slice(0, lastBraceIndex) + proxyBlock + serverBlock.slice(lastBraceIndex);
      
      content = content.replace(serverBlock, patchedServerBlock);
      fs.writeFileSync(configPath, content, 'utf8');
      logger.info(`Successfully injected Nginx proxy location block into ${configPath}`);
      patched = true;
    }
  }

  if (patched) {
    try {
      execSync('systemctl reload nginx || systemctl restart nginx');
      logger.info('Nginx reloaded successfully.');
      return true;
    } catch (err) {
      logger.error(`Failed to reload Nginx: ${err.message}`);
    }
  }

  return patched;
}

if (require.main === module) {
  patchNginx();
}

module.exports = { patchNginx };
