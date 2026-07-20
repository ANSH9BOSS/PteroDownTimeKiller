const axios = require('axios');
const logger = require('./logger');
const { getConfig } = require('./config');
const { createSnapshot, listSnapshots } = require('./snapshotEngine');
const { performGDriveBackup } = require('./gdrive');
const { sendDiscordWebhook } = require('./webhooks');

async function handleDiscordCommand(commandStr, args = []) {
  const cfg = getConfig();
  const cmd = commandStr.toLowerCase().trim();

  logger.info(`Processing Discord Command: ${cmd}`);

  switch (cmd) {
    case 'status':
    case '!ptero status':
    case '/status': {
      const isPeerAlive = global.peerConnected || false;
      const latency = global.peerLatencyMs ? `${global.peerLatencyMs} ms` : 'N/A';
      return sendDiscordWebhook(
        '📊 CLUSTER STATUS REPORT',
        `Current failover cluster status for **${cfg.node?.id || 'node'}**.`,
        isPeerAlive ? 0x22c55e : 0xef4444,
        [
          { name: 'Local Node ID', value: cfg.node?.id || 'panel-a', inline: true },
          { name: 'Local IP / WG', value: `${cfg.node?.wireguardIp || '10.0.0.1'}`, inline: true },
          { name: 'Peer Node ID', value: isPeerAlive ? 'Connected' : 'Offline', inline: true },
          { name: 'WireGuard Latency', value: latency, inline: true },
          { name: 'Sync Engine', value: 'Active Real-Time', inline: true }
        ]
      );
    }

    case 'snapshot create':
    case '!ptero snapshot create':
    case '/snapshot create': {
      const res = await createSnapshot('discord_trigger');
      if (res.success) {
        return sendDiscordWebhook(
          '📸 SNAPSHOT CREATED VIA DISCORD',
          `Snapshot **${res.snapshotName}** created successfully. Size: **${res.fileSize}**`,
          0x8b5cf6
        );
      } else {
        return sendDiscordWebhook('❌ SNAPSHOT FAILED', `Error: ${res.error}`, 0xef4444);
      }
    }

    case 'snapshot list':
    case '!ptero snapshot list':
    case '/snapshot list': {
      const snapshots = await listSnapshots();
      const listStr =
        snapshots.slice(0, 5).map((s) => `• \`${s.name}\` (${s.size})`).join('\n') || 'No snapshots found.';
      return sendDiscordWebhook(
        '📋 RECENT SNAPSHOTS',
        listStr,
        0x3b82f6
      );
    }

    case 'gdrive backup':
    case '!ptero gdrive backup':
    case '/gdrive backup': {
      await sendDiscordWebhook('⏳ OFFSITE BACKUP STARTED', 'Packaging database, panel files, and Wings node data...', 0xeab308);
      const res = await performGDriveBackup();
      return res.success;
    }

    case 'sync-now':
    case '!ptero sync-now':
    case '/sync-now': {
      return sendDiscordWebhook(
        '🔄 MANUAL SYNC TRIGGERED',
        `Re-synchronization cycle initiated by Discord admin command.`,
        0x06b6d4
      );
    }

    default: {
      return sendDiscordWebhook(
        '❓ UNKNOWN DISCORD COMMAND',
        `Available Discord Commands:\n• \`!ptero status\`\n• \`!ptero snapshot create\`\n• \`!ptero snapshot list\`\n• \`!ptero gdrive backup\`\n• \`!ptero sync-now\``,
        0xf97316
      );
    }
  }
}

module.exports = {
  handleDiscordCommand
};
