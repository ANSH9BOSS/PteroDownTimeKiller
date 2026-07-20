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

function injectProxyIntoAllServers(content) {
  let output = '';
  let index = 0;

  const proxyBlock = `
    location /api/sync/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
`;

  while (index < content.length) {
    const serverIndex = content.indexOf('server', index);
    if (serverIndex === -1) {
      output += content.slice(index);
      break;
    }

    // Find the next opening brace '{'
    const openBraceIndex = content.indexOf('{', serverIndex);
    if (openBraceIndex === -1) {
      output += content.slice(index, serverIndex + 6);
      index = serverIndex + 6;
      continue;
    }

    // Copy everything up to "server"
    output += content.slice(index, serverIndex);

    // Find matching closing brace '}' for this server block
    let braceCount = 0;
    let serverEndIndex = -1;
    for (let i = openBraceIndex; i < content.length; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') braceCount--;
      if (braceCount === 0) {
        serverEndIndex = i;
        break;
      }
    }

    if (serverEndIndex !== -1) {
      const serverContent = content.slice(serverIndex, serverEndIndex);
      
      // Inject proxy block only if not already present in this server block
      let patchedBlock = serverContent;
      if (!serverContent.includes('location /api/sync/')) {
        patchedBlock = serverContent + proxyBlock;
      }
      output += patchedBlock + '}';
      index = serverEndIndex + 1;
    } else {
      output += content.slice(serverIndex, openBraceIndex + 1);
      index = openBraceIndex + 1;
    }
  }

  return output;
}

function patchNginx() {
  let patched = false;

  for (const configPath of CONFIG_PATHS) {
    if (!fs.existsSync(configPath)) continue;

    let content = fs.readFileSync(configPath, 'utf8');

    // Run brace parsing injection
    const patchedContent = injectProxyIntoAllServers(content);
    if (patchedContent !== content) {
      fs.writeFileSync(configPath, patchedContent, 'utf8');
      logger.info(`Successfully injected Nginx proxy location blocks into ${configPath}`);
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
