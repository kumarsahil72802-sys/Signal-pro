const Signal = require('../models/Signal');

/**
 * Keep short-lived outcomes auto-cleaned:
 * - CLOSED + TARGET_HIT
 * - CLOSED + SL_HIT
 * - CLOSED + EXPIRED
 */
const TTL_PARTIAL_FILTER = {
  $or: [
    { status: 'CLOSED', result: 'TARGET_HIT' },
    { status: 'CLOSED', result: 'SL_HIT' },
    { status: 'CLOSED', result: 'EXPIRED' }
  ]
};
const OUTCOME_CLEANUP_TTL_MS = 8 * 60 * 60 * 1000;

function hasClause(clauses, expectedStatus, expectedResult = null) {
  return clauses.some((clause) => {
    if (!clause || clause.status !== expectedStatus) return false;
    if (expectedResult == null) return !('result' in clause);
    return clause.result === expectedResult;
  });
}

function hasExpectedTtlFilter(partialFilter) {
  if (!partialFilter || typeof partialFilter !== 'object') return false;
  const clauses = Array.isArray(partialFilter.$or) ? partialFilter.$or : [];
  if (clauses.length !== 3) return false;

  return (
    hasClause(clauses, 'CLOSED', 'TARGET_HIT') &&
    hasClause(clauses, 'CLOSED', 'SL_HIT') &&
    hasClause(clauses, 'CLOSED', 'EXPIRED')
  );
}

async function enforceSignalRetentionPolicy() {
  try {
    const indexes = await Signal.collection.indexes();
    const ttlIndex = indexes.find((idx) => idx.key?.expireAt === 1);

    const hasCorrectPartialFilter =
      ttlIndex?.partialFilterExpression &&
      hasExpectedTtlFilter(ttlIndex.partialFilterExpression);

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
          partialFilterExpression: TTL_PARTIAL_FILTER
        }
      );
      console.log('[Retention] Created partial TTL index for TARGET_HIT + SL_HIT + EXPIRED outcomes.');
    }

    await Signal.updateMany(
      { status: 'MISSED' },
      [
        {
          $set: {
            status: 'CLOSED',
            result: 'TARGET_HIT',
            isMissedOpportunity: true,
            closedAt: {
              $ifNull: ['$closedAt', { $ifNull: ['$missedAt', '$createdAt'] }]
            }
          }
        }
      ]
    );

    const closedBackfill = await Signal.updateMany(
      {
        status: 'CLOSED',
        result: { $in: ['TARGET_HIT', 'SL_HIT', 'EXPIRED'] },
        expireAt: { $not: { $type: 'date' } },
        $or: [
          { closedAt: { $type: 'date' } },
          { missedAt: { $type: 'date' } },
          { createdAt: { $type: 'date' } }
        ]
      },
      [
        {
          $set: {
            closedAt: {
              $ifNull: ['$closedAt', { $ifNull: ['$missedAt', '$createdAt'] }]
            },
            expireAt: {
              $toDate: {
                $add: [
                  {
                    $ifNull: [
                      { $toLong: '$closedAt' },
                      {
                        $ifNull: [{ $toLong: '$missedAt' }, { $toLong: '$createdAt' }]
                      }
                    ]
                  },
                  OUTCOME_CLEANUP_TTL_MS
                ]
              }
            }
          }
        }
      ]
    );

    const backfilledCount = closedBackfill.modifiedCount || 0;
    if (backfilledCount > 0) {
      console.log(`[Retention] Backfilled expireAt for ${backfilledCount} eligible outcomes.`);
    }

    const cleanupResult = await Signal.updateMany(
      {
        $nor: [
          { status: 'CLOSED', result: 'TARGET_HIT' },
          { status: 'CLOSED', result: 'SL_HIT' },
          { status: 'CLOSED', result: 'EXPIRED' }
        ],
        expireAt: { $type: 'date' }
      },
      {
        $unset: { expireAt: '' }
      }
    );

    if (cleanupResult.modifiedCount > 0) {
      console.log(`[Retention] Cleared expireAt from ${cleanupResult.modifiedCount} non-cleanup-eligible signals.`);
    }
  } catch (error) {
    console.error(`[Retention] Failed to enforce policy: ${error.message}`);
  }
}

module.exports = { enforceSignalRetentionPolicy };
