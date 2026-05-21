const Signal = require('../models/Signal');

/**
 * Keep short-lived outcomes auto-cleaned:
 * - CLOSED + TARGET_HIT
 * - CLOSED + SL_HIT
 * - CLOSED + EXPIRED
 * - CLOSED + MANUALLY_CLOSED
 * - BLOCKED
 */
const TTL_PARTIAL_FILTER = {
  $or: [
    { status: 'CLOSED', result: 'TARGET_HIT' },
    { status: 'CLOSED', result: 'SL_HIT' },
    { status: 'CLOSED', result: 'EXPIRED' },
    { status: 'CLOSED', result: 'MANUALLY_CLOSED' },
    { status: 'BLOCKED' }
  ]
};
const OUTCOME_CLEANUP_TTL_MS = 8 * 60 * 60 * 1000;
const CLEANUP_ELIGIBLE_CLAUSES = [
  { status: 'CLOSED', result: 'TARGET_HIT' },
  { status: 'CLOSED', result: 'SL_HIT' },
  { status: 'CLOSED', result: 'EXPIRED' },
  { status: 'CLOSED', result: 'MANUALLY_CLOSED' },
  { status: 'BLOCKED', result: null }
];

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
  if (clauses.length !== CLEANUP_ELIGIBLE_CLAUSES.length) return false;

  return CLEANUP_ELIGIBLE_CLAUSES.every((clause) => hasClause(clauses, clause.status, clause.result));
}

function buildBulkWriteResult(modifiedCount = 0) {
  return { modifiedCount };
}

function resolveClosedAt(signal) {
  const candidate = signal?.closedAt || signal?.missedAt || signal?.createdAt;
  const resolved = candidate ? new Date(candidate) : null;
  if (!resolved) return null;
  return Number.isFinite(resolved.getTime()) ? resolved : null;
}

async function runPipelineUpdateWithFallback({
  label,
  filter,
  pipeline,
  fallback
}) {
  try {
    const result = await Signal.updateMany(filter, pipeline, { updatePipeline: true });
    console.log(`[Retention] ${label}: pipeline_applied (${result.modifiedCount || 0} modified).`);
    return result;
  } catch (error) {
    console.warn(`[Retention] ${label}: pipeline_failed (${error.message}) -> fallback_applied.`);
    const fallbackResult = await fallback();
    const modified = fallbackResult?.modifiedCount || 0;
    console.log(`[Retention] ${label}: fallback_applied (${modified} modified).`);
    return fallbackResult;
  }
}

async function fallbackMigrateMissedSignals() {
  const missedSignals = await Signal.find(
    { status: 'MISSED' },
    { _id: 1, closedAt: 1, missedAt: 1, createdAt: 1 }
  ).lean();

  if (missedSignals.length === 0) {
    return buildBulkWriteResult(0);
  }

  const ops = missedSignals.map((signal) => {
    const closedAt = resolveClosedAt(signal) || new Date();
    return {
      updateOne: {
        filter: { _id: signal._id },
        update: {
          $set: {
            status: 'CLOSED',
            result: 'TARGET_HIT',
            isMissedOpportunity: true,
            closedAt
          }
        }
      }
    };
  });

  const result = await Signal.bulkWrite(ops, { ordered: false });
  return buildBulkWriteResult(result.modifiedCount || 0);
}

async function fallbackBackfillCleanupEligibleSignals() {
  const signals = await Signal.find(
    {
      $or: [
        { status: 'CLOSED', result: { $in: ['TARGET_HIT', 'SL_HIT', 'EXPIRED', 'MANUALLY_CLOSED'] } },
        { status: 'BLOCKED' }
      ],
      expireAt: { $not: { $type: 'date' } },
      $or: [
        { closedAt: { $type: 'date' } },
        { missedAt: { $type: 'date' } },
        { persistGateBlockedAt: { $type: 'date' } },
        { createdAt: { $type: 'date' } }
      ]
    },
    { _id: 1, status: 1, closedAt: 1, missedAt: 1, persistGateBlockedAt: 1, createdAt: 1 }
  ).lean();

  if (signals.length === 0) {
    return buildBulkWriteResult(0);
  }

  const ops = [];
  for (const signal of signals) {
    const baseTime = signal.status === 'BLOCKED'
      ? (signal.persistGateBlockedAt ? new Date(signal.persistGateBlockedAt) : new Date(signal.createdAt))
      : resolveClosedAt(signal);
    if (!baseTime || !Number.isFinite(baseTime.getTime())) continue;

    ops.push({
      updateOne: {
        filter: { _id: signal._id },
        update: {
          $set: {
            expireAt: new Date(baseTime.getTime() + OUTCOME_CLEANUP_TTL_MS)
          }
        }
      }
    });
  }

  if (ops.length === 0) {
    return buildBulkWriteResult(0);
  }

  const result = await Signal.bulkWrite(ops, { ordered: false });
  return buildBulkWriteResult(result.modifiedCount || 0);
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
      console.log('[Retention] Created partial TTL index for cleanup-eligible outcomes (closed outcomes + blocked).');
    }

    await runPipelineUpdateWithFallback({
      label: 'missed_signal_migration',
      filter: { status: 'MISSED' },
      pipeline: [
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
      ],
      fallback: fallbackMigrateMissedSignals
    });

    const cleanupEligibleBackfill = await runPipelineUpdateWithFallback({
      label: 'cleanup_eligible_backfill',
      filter: {
        $or: [
          { status: 'CLOSED', result: { $in: ['TARGET_HIT', 'SL_HIT', 'EXPIRED', 'MANUALLY_CLOSED'] } },
          { status: 'BLOCKED' }
        ],
        expireAt: { $not: { $type: 'date' } },
        $or: [
          { closedAt: { $type: 'date' } },
          { missedAt: { $type: 'date' } },
          { persistGateBlockedAt: { $type: 'date' } },
          { createdAt: { $type: 'date' } }
        ]
      },
      pipeline: [
        {
          $set: {
            closedAt: {
              $ifNull: ['$closedAt', { $ifNull: ['$missedAt', '$createdAt'] }]
            },
            expireAt: {
              $toDate: {
                $add: [
                  {
                    $cond: [
                      { $eq: ['$status', 'BLOCKED'] },
                      {
                        $ifNull: [{ $toLong: '$persistGateBlockedAt' }, { $toLong: '$createdAt' }]
                      },
                      {
                        $ifNull: [
                          { $toLong: '$closedAt' },
                          {
                            $ifNull: [{ $toLong: '$missedAt' }, { $toLong: '$createdAt' }]
                          }
                        ]
                      }
                    ]
                  },
                  OUTCOME_CLEANUP_TTL_MS
                ]
              }
            }
          }
        }
      ],
      fallback: fallbackBackfillCleanupEligibleSignals
    });

    const backfilledCount = cleanupEligibleBackfill.modifiedCount || 0;
    if (backfilledCount > 0) {
      console.log(`[Retention] Backfilled expireAt for ${backfilledCount} cleanup-eligible signals.`);
    }

    const cleanupResult = await Signal.updateMany(
      {
        $nor: [
          { status: 'CLOSED', result: 'TARGET_HIT' },
          { status: 'CLOSED', result: 'SL_HIT' },
          { status: 'CLOSED', result: 'EXPIRED' },
          { status: 'CLOSED', result: 'MANUALLY_CLOSED' },
          { status: 'BLOCKED' }
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
