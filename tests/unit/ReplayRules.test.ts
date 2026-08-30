import { describe, it, expect } from 'vitest';
import { validateRulesSnapshotContract, CLEAN_POOL_REPLAY_RULES, VOID_REPLAY_RULES } from '../../src/core/ReplayRules.ts';

describe('ReplayRules', () => {
  describe('validateRulesSnapshotContract', () => {
    it('should validate canonical V8 snapshot (clean pool)', () => {
      // Must be a complete match
      const snapshot = JSON.parse(JSON.stringify(CLEAN_POOL_REPLAY_RULES));
      const res = validateRulesSnapshotContract(snapshot);
      expect(res.valid).toBe(true);
    });

    it('should validate canonical V5 snapshot (void rules)', () => {
      const snapshot = JSON.parse(JSON.stringify(VOID_REPLAY_RULES));
      const res = validateRulesSnapshotContract(snapshot);
      expect(res.valid).toBe(true);
    });

    it('should reject missing rulesVersion', () => {
      const snapshot = { gameMode: 'volatility_trade' };
      const res = validateRulesSnapshotContract(snapshot);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/Invalid or missing rulesVersion/);
    });

    it('should reject unsupported rulesVersion', () => {
      const snapshot = { rulesVersion: 999 };
      const res = validateRulesSnapshotContract(snapshot);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/Unsupported rulesVersion 999/);
    });

    it('should reject missing frozen fields', () => {
      const snapshot = JSON.parse(JSON.stringify(CLEAN_POOL_REPLAY_RULES));
      delete snapshot.voidKMin; // V5+ field
      const res = validateRulesSnapshotContract(snapshot);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/Missing field at voidKMin/);
    });

    it('should reject extra fields', () => {
      const snapshot = JSON.parse(JSON.stringify(CLEAN_POOL_REPLAY_RULES));
      snapshot.unknownField = 'hello';
      const res = validateRulesSnapshotContract(snapshot);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/Extra field at unknownField/);
    });

    it('should reject volatility model drift', () => {
      const snapshot = JSON.parse(JSON.stringify(CLEAN_POOL_REPLAY_RULES));
      snapshot.volatility.model = 'conflict_banded'; // V8 should be trend_window
      const res = validateRulesSnapshotContract(snapshot);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/Mismatch at volatility.model/);
    });

    it('should reject void card drift', () => {
      const snapshot = JSON.parse(JSON.stringify(CLEAN_POOL_REPLAY_RULES));
      snapshot.voidCardCount = 99; // should be 3
      const res = validateRulesSnapshotContract(snapshot);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/Mismatch at voidCardCount/);
    });

    it('should reject trend window drift', () => {
      const snapshot = JSON.parse(JSON.stringify(CLEAN_POOL_REPLAY_RULES));
      snapshot.trendWindow.enabled = false;
      const res = validateRulesSnapshotContract(snapshot);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/Mismatch at trendWindow.enabled/);
    });

    it('should reject branch roll drift', () => {
      const snapshot = JSON.parse(JSON.stringify(CLEAN_POOL_REPLAY_RULES));
      snapshot.branchRoll.delta = 3;
      const res = validateRulesSnapshotContract(snapshot);
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/Mismatch at branchRoll.delta/);
    });

    it('should reject non-object snapshot', () => {
      expect(validateRulesSnapshotContract(null).valid).toBe(false);
      expect(validateRulesSnapshotContract('string').valid).toBe(false);
    });
  });
});
