import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/shared/config.js';

describe('CONFIG defaults', () => {
  it('has all required sections', () => {
    expect(CONFIG).toHaveProperty('models');
    expect(CONFIG).toHaveProperty('api');
    expect(CONFIG).toHaveProperty('agent');
    expect(CONFIG).toHaveProperty('compaction');
    expect(CONFIG).toHaveProperty('dom');
    expect(CONFIG).toHaveProperty('timeouts');
  });

  it('has valid model IDs', () => {
    expect(CONFIG.models.agent).toMatch(/^claude-/);
    expect(CONFIG.models.compactor).toMatch(/^claude-/);
  });

  it('has valid API config', () => {
    expect(CONFIG.api.baseUrl).toMatch(/^https:\/\//);
    expect(CONFIG.api.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CONFIG.api.maxTokensAgent).toBeGreaterThan(0);
    expect(CONFIG.api.maxTokensCompact).toBeGreaterThan(0);
  });

  it('has valid agent config', () => {
    expect(CONFIG.agent.maxTurns).toBeGreaterThan(0);
    expect(CONFIG.agent.confidenceThreshold).toBeGreaterThanOrEqual(0);
    expect(CONFIG.agent.confidenceThreshold).toBeLessThanOrEqual(100);
    expect(CONFIG.agent.selectorFailureHintAt).toBeGreaterThan(0);
    expect(CONFIG.agent.maxHistorySnapshots).toBeGreaterThan(0);
  });

  it('has valid compaction config', () => {
    expect(CONFIG.compaction.tokenThreshold).toBeGreaterThan(0);
    expect(CONFIG.compaction.microCompactKeep).toBeGreaterThan(0);
    expect(CONFIG.compaction.fullCompactKeep).toBeGreaterThan(0);
    expect(CONFIG.compaction.charsPerToken).toBeGreaterThan(0);
  });

  it('has valid DOM config', () => {
    expect(CONFIG.dom.elementCap).toBeGreaterThan(0);
    expect(CONFIG.dom.fingerprintSampleSize).toBeLessThanOrEqual(CONFIG.dom.elementCap);
    expect(CONFIG.dom.textSliceLength).toBeGreaterThan(0);
    expect(CONFIG.dom.maxClassesPerElement).toBeGreaterThan(0);
    expect(CONFIG.dom.selectorPreviewCount).toBeGreaterThan(0);
  });

  it('has valid timeout config', () => {
    expect(CONFIG.timeouts.toolExecDefault).toBeGreaterThan(0);
    expect(CONFIG.timeouts.toolExecCheckDynamic).toBeGreaterThan(0);
    expect(CONFIG.timeouts.askUser).toBeGreaterThan(0);
    expect(CONFIG.timeouts.keepAlivePing).toBeGreaterThan(0);
    expect(CONFIG.timeouts.checkDynamicWatch).toBeGreaterThan(0);
    expect(CONFIG.timeouts.modalAutoClose).toBeGreaterThan(0);
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(CONFIG)).toBe(true);
  });
});
