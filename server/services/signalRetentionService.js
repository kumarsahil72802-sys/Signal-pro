const Signal = require('../models/Signal');

/**
 * Ensure TTL applies only to MISSED signals and preserve historical outcomes.
 * This protects CLOSED/TAKEN/ACTIVE records from accidental auto-deletion.
 */
async function enforceSignalRetentionPolicy() {
  try {
    const indexes = await Signal.collection.indexes();
    const ttlIndex = indexes.find((idx) => idx.key?.expireAt === 1);

    const hasCorrectPartialFilter =
      ttlIndex?.partialFilterExpression &&
      ttlIndex.partialFilterExpression.status === 'MISSED';

    const hasCorrectExpirePolicy = ttlIndex?.expireAfterSeconds === 0;

    if (ttlIndex && (!hasCorrectPartialFilter || !hasCorrectExpirePolicy)) {
      await Signal.collection.dropIndex(ttlIndex.name);
      console.log(`[Retention] Dropped legacy TTL index: ${ttlIndex.name}`);
    }

    if (!ttlIndex || !hasCorrectPartialFilter || !hasCorrectExpirePolicy) {
      await Signal.collection.createIndex(
        { expireAt: 1 },
        {
          expireAfterSeconds: 0,
          partialFilterExpression: { status: 'MISSED' }
        }
      );
      console.log('[Retention] Created partial TTL index for MISSED signals only.');
    }

    const cleanupResult = await Signal.updateMany(
      {
        status: { $ne: 'MISSED' },
        expireAt: { $type: 'date' }
      },
      {
        $unset: { expireAt: '' }
      }
    );

    if (cleanupResult.modifiedCount > 0) {
      console.log(`[Retention] Cleared expireAt from ${cleanupResult.modifiedCount} non-MISSED signals.`);
    }
  } catch (error) {
    console.error(`[Retention] Failed to enforce policy: ${error.message}`);
  }
}

module.exports = { enforceSignalRetentionPolicy };

