const { exec } = require('child_process');
const fs = require('fs-extra');
const util = require('util');
const execAsync = util.promisify(exec);
const logger = require('../src/logger');

async function generateWgKeys() {
  try {
    const priv = await execAsync('wg genkey');
    const privateKey = priv.stdout.trim();
    const pub = await execAsync(`echo "${privateKey}" | wg pubkey`);
    const publicKey = pub.stdout.trim();
    return { privateKey, publicKey };
  } catch (err) {
    logger.error(`Failed to generate WireGuard keys: ${err.message}`);
    // Fallback pseudo keys for testing if wg binary isn't present
    return {
      privateKey: 'PRIV_' + Math.random().toString(36).substr(2, 32),
      publicKey: 'PUB_' + Math.random().toString(36).substr(2, 32)
    };
  }
}

function generatePrimaryWgConfig(privateKey, secondaryPubKey, secondaryPublicIp) {
  return `[Interface]
PrivateKey = ${privateKey}
Address = 10.0.0.1/24
ListenPort = 51820

[Peer]
PublicKey = ${secondaryPubKey}
Endpoint = ${secondaryPublicIp}:51820
AllowedIPs = 10.0.0.2/32
PersistentKeepalive = 25
`;
}

function generateSecondaryWgConfig(privateKey, primaryPubKey, primaryPublicIp) {
  return `[Interface]
PrivateKey = ${privateKey}
Address = 10.0.0.2/24
ListenPort = 51820

[Peer]
PublicKey = ${primaryPubKey}
Endpoint = ${primaryPublicIp}:51820
AllowedIPs = 10.0.0.1/32
PersistentKeepalive = 25
`;
}

module.exports = {
  generateWgKeys,
  generatePrimaryWgConfig,
  generateSecondaryWgConfig
};
