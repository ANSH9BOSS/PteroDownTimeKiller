const axios = require('axios');
const { getConfig } = require('./config');
const logger = require('./logger');

async function sendDiscordWebhook(title, description, color = 0x3b82f6, fields = []) {
  const cfg = getConfig();
  const webhookUrl = cfg.discord?.webhookUrl || process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl || webhookUrl.includes('your-webhook-id')) {
    logger.debug('Discord webhook skipped: Webhook URL not configured');
    return false;
  }

  const embed = {
    title: `⚡ PteroDownTimeKiller: ${title}`,
    description: description,
    color: color,
    fields: [
      { name: '📍 Node', value: cfg.node?.id || 'Unknown', inline: true },
      { name: '🕒 Timestamp', value: new Date().toISOString(), inline: true },
      ...fields
    ],
    footer: {
      text: 'PteroDownTimeKiller Active-Active Failover'
    }
  };

  try {
    await axios.post(webhookUrl, { embeds: [embed] });
    logger.info(`Discord webhook sent successfully: ${title}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send Discord webhook: ${err.message}`);
    return false;
  }
}

async function notifyFailover(downNode, activeNode) {
  return sendDiscordWebhook(
    '🚨 FAILOVER TRIGGERED',
    `Node **${downNode}** is down! Traffic shifted to **${activeNode}**. Zero panel downtime experienced by Wings nodes.`,
    0xef4444,
    [{ name: 'Active Node', value: activeNode, inline: true }]
  );
}

async function notifyRecovery(recoveredNode) {
  return sendDiscordWebhook(
    '🟢 PEER RECOVERED & AUTO-HEAL STARTED',
    `Node **${recoveredNode}** came back online! Catching up missed files and database transactions automatically.`,
    0x22c55e
  );
}

async function notifyAutoHealComplete(recoveredNode, fileCount, dbChangeCount) {
  return sendDiscordWebhook(
    '✅ AUTO-HEAL COMPLETE',
    `Node **${recoveredNode}** caught up seamlessly with the active cluster state!`,
    0x10b981,
    [
      { name: 'Files Synced', value: `${fileCount}`, inline: true },
      { name: 'DB Deltas Replayed', value: `${dbChangeCount}`, inline: true }
    ]
  );
}

async function notifySnapshotCreated(snapshotName, fileSize, gdriveUrl = null) {
  const fields = [{ name: 'Archive Size', value: fileSize, inline: true }];
  if (gdriveUrl) {
    fields.push({ name: 'Google Drive Link', value: `[View in Drive](${gdriveUrl})`, inline: true });
  }

  return sendDiscordWebhook(
    '📸 DATABASE & NODE SNAPSHOT CREATED',
    `Snapshot **${snapshotName}** stored safely.`,
    0x8b5cf6,
    fields
  );
}

async function notifyGDriveBackupSuccess(fileName, fileSize, driveLink) {
  return sendDiscordWebhook(
    '☁️ GOOGLE DRIVE OFFSITE BACKUP COMPLETE',
    `Full backup (Panel files, extensions, eggs, MySQL DB & Wings nodes config) uploaded to Google Drive!`,
    0x06b6d4,
    [
      { name: 'File Name', value: fileName, inline: false },
      { name: 'Archive Size', value: fileSize, inline: true },
      { name: 'Google Drive', value: `[Open Link](${driveLink})`, inline: true }
    ]
  );
}

module.exports = {
  sendDiscordWebhook,
  notifyFailover,
  notifyRecovery,
  notifyAutoHealComplete,
  notifySnapshotCreated,
  notifyGDriveBackupSuccess
};
