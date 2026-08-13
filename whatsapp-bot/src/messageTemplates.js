export function formatBeginnerTaskMessage(taskNumber, product) {
  return (
    `*Task #${taskNumber}*\n\n` +
    `📋 Copy Amazon Product Link\n\n` +
    `Product: *${product.title}*\n\n` +
    `Paste the link into your working site and earn your commission!\n\n` +
    `⏱ Duration: 30 minutes`
  );
}

export function formatTellerTaskMessage(taskNumber, tellerProducts) {
  const header =
    `*Task #${taskNumber}*\n\n` +
    `📦 Process Teller Packages\n\n` +
    `Handle and process teller package items as instructed.\n\n` +
    `⏱ Duration: 50 minutes\n\n`;

  if (!tellerProducts || tellerProducts.length === 0) {
    return header + '_No packages currently available._';
  }

  const rows = tellerProducts
    .map(p => `${String(p.amount).padEnd(9)} ${String(`${p.profit} (${p.commissionPercent}%)`).padEnd(16)} ${p.totalReturn}`)
    .join('\n');

  const table =
    '```\n' +
    '🔵 Teller Network - Task Packages\n' +
    `${'Amount (GHC)'.padEnd(9)} ${'Profit'.padEnd(16)} Total Return\n` +
    rows +
    '\n```';

  return header + table;
}
