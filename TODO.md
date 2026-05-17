# TODO - Verify whether Signal generation is correct

## Plan summary (from repo inspection so far)
- Entry point: `server/services/signalEngine/runner.js` → `generateSignalForCoin()`
- Core generation: `server/services/signalEngine/generatorParts/generateSignalForCoin.js`
- Quality gating / thresholds: `server/services/signalEngine/generatorParts/core.js` + `configParts/thresholdStore.js`
- Final AI enrichment: `enhancedAnalyze()` from `server/services/aiAnalyst.js`
- Risk/Execution finalization: `buildRiskManagedSignalData()` + `evaluateExecutionIntelligence()` + `finalizeExecutionDecision()`
- Persistence/duplicate blocks: checks `Signal` model status + `validUntil` logic
- Learning uses only taken signals for threshold adjustments

## Steps to complete
1. Confirm the exact definition of “correct generation” by checking signal model schema (`server/models/Signal.js`) and how UI consumes fields.
2. Review the final gating logic: `validateFinalSignalQuality` + `passQualityGate` + hard blocks (4H, BTC, execution quality).
3. Review AI enrichment output mapping: ensure `enhancedAnalyze()` returns fields that match what the engine expects.
4. Check risk engine consistency: entry/target/stop/rr calculations and direction validity.
5. Add a quick automated test/sanity script to validate invariants for generated signals (BUY/SELL ordering, confidence>=threshold, validUntil set, RR direction correct).
6. Run tests (`npm test` in relevant folders) and/or run the engine in a dry-run mode if available.

