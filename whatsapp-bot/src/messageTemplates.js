export function formatBeginnerTaskMessage(taskNumber, product) {
  return (
    `*Task #${taskNumber}*\n\n` +
    `📋 Copy Amazon Product Link\n\n` +
    `Product: *${product.title}*\n\n` +
    `Paste the link into your working site and earn your commission!\n\n` +
    `⏱ Duration: 30 minutes`
  );
}

export function formatTellerTaskMessage(taskNumber) {
  return (
    `*Task #${taskNumber}*\n\n` +
    `📦 Process Teller Packages\n\n` +
    `See the package list in the image above. Handle and process teller package items as instructed.\n\n` +
    `⏱ Duration: 50 minutes`
  );
}
