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

async function fallbackBackfillClosedOutcomes() {
  const signals = await Signal.find(
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
    { _id: 1, closedAt: 1, missedAt: 1, createdAt: 1 }
  ).lean();

  if (signals.length === 0) {
    return buildBulkWriteResult(0);
  }

  const ops = [];
  for (const signal of signals) {
    const closedAt = resolveClosedAt(signal);
    if (!closedAt) continue;

    ops.push({
      updateOne: {
        filter: { _id: signal._id },
        update: {
          $set: {
            closedAt,
            expireAt: new Date(closedAt.getTime() + OUTCOME_CLEANUP_TTL_MS)
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
      console.log('[Retention] Created partial TTL index for TARGET_HIT + SL_HIT + EXPIRED outcomes.');
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

    const closedBackfill = await runPipelineUpdateWithFallback({
      label: 'closed_outcome_backfill',
      filter: {
        status: 'CLOSED',
        result: { $in: ['TARGET_HIT', 'SL_HIT', 'EXPIRED'] },
        expireAt: { $not: { $type: 'date' } },
        $or: [
          { closedAt: { $type: 'date' } },
          { missedAt: { $type: 'date' } },
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
      ],
      fallback: fallbackBackfillClosedOutcomes
    });

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
