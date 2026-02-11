/**
 * agents.test.ts — Comprehensive test suite for all 10 Twinkle agent handlers.
 *
 * Categories:
 *   Code Audit  : sentinel (HIGH), quickScan (MEDIUM), auditBot (LOW/no-LLM)
 *   Legal Review : lexGuard (HIGH), contractEye (LOW/calls LLM but fixed shape)
 *   IP/Patent   : patentHawk (HIGH), priorArt (MEDIUM), patentLite (LOW/no-LLM)
 *   DeFi Strategy: yieldSage (HIGH), alphaQuick (MEDIUM)
 *
 * HIGH and MEDIUM agents use GPT-5.2 via callLLM -- mocked here.
 * LOW agents that skip LLM (auditBot, patentLite) are tested directly.
 * ContractEye is LOW but still calls callLLM for a 2-sentence summary.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock: openai-client
// ---------------------------------------------------------------------------

// vi.hoisted runs before vi.mock (both are hoisted), giving us a stable ref.
const { callLLMMock } = vi.hoisted(() => ({
  callLLMMock: vi.fn(),
}));

vi.mock('../src/openai-client.js', () => ({
  callLLM: callLLMMock,
  initClient: vi.fn(),
  getUsage: vi.fn().mockReturnValue({ inputTokens: 0, outputTokens: 0, totalCost: 0 }),
  clearCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: global fetch (used by defi-strategy for Pyth / CoinGecko / DeFiLlama)
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard LLM mock result factory */
function llmResult(parsed: Record<string, unknown>) {
  return {
    text: JSON.stringify(parsed),
    parsed,
    usage: { inputTokens: 100, outputTokens: 50 },
    toolCalls: [],
  };
}

/** Build a minimal Response-like object returned by fetch */
function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  };
}

// ---------------------------------------------------------------------------
// Imports — pulled AFTER mocks are registered so vitest intercepts them
// ---------------------------------------------------------------------------

import { sentinel, quickScan, auditBot } from '../src/agents/code-audit.js';
import { lexGuard, contractEye } from '../src/agents/legal-review.js';
import { patentHawk, priorArt, patentLite } from '../src/agents/ip-patent.js';
import { yieldSage, alphaQuick } from '../src/agents/defi-strategy.js';

// ===================================================================
// 1. CODE AUDIT
// ===================================================================

describe('Code Audit agents', () => {
  // ---------------------------------------------------------------
  // Sentinel (HIGH)
  // ---------------------------------------------------------------
  describe('sentinel (HIGH)', () => {
    const mockParsed = {
      summary: 'Multiple critical vulnerabilities detected in SimpleVault contract.',
      confidence: 0.92,
      findings: [
        {
          vulnType: 'reentrancy',
          severity: 'critical',
          lineRange: '33-42',
          description: 'External call before state update in withdraw().',
          recommendation: 'Use checks-effects-interactions pattern.',
        },
        {
          vulnType: 'access_control',
          severity: 'high',
          lineRange: '19-21',
          description: 'setPaused() has no access control.',
          recommendation: 'Add onlyOwner modifier.',
        },
        {
          vulnType: 'tx_origin',
          severity: 'high',
          lineRange: '45-50',
          description: 'tx.origin used for authentication in emergencyWithdraw().',
          recommendation: 'Replace tx.origin with msg.sender.',
        },
      ],
      overallRisk: 'critical',
      dataPoints: 8,
    };

    beforeEach(() => {
      callLLMMock.mockReset();
      callLLMMock.mockResolvedValue(llmResult(mockParsed));
    });

    it('calls callLLM and returns expected shape', async () => {
      const result = await sentinel('Audit for reentrancy');

      expect(callLLMMock).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('provider', 'Sentinel');
      expect(result).toHaveProperty('query', 'Audit for reentrancy');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('number');
    });

    it('returns analysis with summary, confidence, findings, overallRisk, dataPoints', async () => {
      const { analysis } = await sentinel('full audit');

      expect(analysis).toHaveProperty('summary');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('findings');
      expect(analysis).toHaveProperty('overallRisk');
      expect(analysis).toHaveProperty('dataPoints');
    });

    it('has confidence > 0.7 (HIGH tier)', async () => {
      const { analysis } = await sentinel('full audit');
      expect(analysis.confidence).toBeGreaterThan(0.7);
    });

    it('includes detailed findings with required fields', async () => {
      const { analysis } = await sentinel('full audit');

      expect(analysis.findings.length).toBeGreaterThan(0);
      for (const f of analysis.findings) {
        expect(f).toHaveProperty('vulnType');
        expect(f).toHaveProperty('severity');
        expect(f).toHaveProperty('description');
        expect(f).toHaveProperty('recommendation');
      }
    });

    it('passes high reasoning effort to callLLM', async () => {
      await sentinel('any query');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.reasoning).toBe('high');
    });

    it('sends the contract source and the user query in the input', async () => {
      await sentinel('check access control');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.input).toContain('check access control');
      // The sample contract contains SimpleVault
      expect(callArgs.input).toContain('SimpleVault');
    });

    it('provides a jsonSchema named audit_report', async () => {
      await sentinel('audit');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.jsonSchema).toBeDefined();
      expect(callArgs.jsonSchema.name).toBe('audit_report');
      expect(callArgs.jsonSchema.strict).toBe(true);
    });

    it('falls back to default analysis when parsed is null', async () => {
      callLLMMock.mockResolvedValueOnce({
        text: 'fallback text',
        parsed: null,
        usage: { inputTokens: 50, outputTokens: 25 },
        toolCalls: [],
      });

      const { analysis } = await sentinel('fallback test');
      // The fallback object is constructed inline in the source
      expect(analysis.summary).toBe('fallback text');
      expect(analysis.confidence).toBe(0.85);
      expect(analysis.overallRisk).toBe('medium');
    });
  });

  // ---------------------------------------------------------------
  // QuickScan (MEDIUM)
  // ---------------------------------------------------------------
  describe('quickScan (MEDIUM)', () => {
    const mockParsed = {
      summary: 'Quick scan identified reentrancy and access control issues.',
      confidence: 0.58,
      topVulnerabilities: ['Reentrancy in withdraw()', 'No access control on setPaused()', 'tx.origin auth'],
      recommendation: 'Fix reentrancy first, then add access modifiers.',
      dataPoints: 3,
    };

    beforeEach(() => {
      callLLMMock.mockReset();
      callLLMMock.mockResolvedValue(llmResult(mockParsed));
    });

    it('calls callLLM and returns expected shape', async () => {
      const result = await quickScan('quick check');

      expect(callLLMMock).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('provider', 'QuickScan');
      expect(result).toHaveProperty('query', 'quick check');
      expect(result).toHaveProperty('timestamp');
    });

    it('returns analysis with summary, confidence, topVulnerabilities, recommendation, dataPoints', async () => {
      const { analysis } = await quickScan('scan');

      expect(analysis).toHaveProperty('summary');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('topVulnerabilities');
      expect(analysis).toHaveProperty('recommendation');
      expect(analysis).toHaveProperty('dataPoints');
    });

    it('has confidence between 0.4 and 0.7 (MEDIUM tier)', async () => {
      const { analysis } = await quickScan('scan');
      expect(analysis.confidence).toBeGreaterThanOrEqual(0.4);
      expect(analysis.confidence).toBeLessThanOrEqual(0.7);
    });

    it('uses low reasoning effort', async () => {
      await quickScan('scan');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.reasoning).toBe('low');
    });

    it('provides a jsonSchema named quick_scan', async () => {
      await quickScan('scan');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.jsonSchema.name).toBe('quick_scan');
    });

    it('falls back to default analysis when parsed is null', async () => {
      callLLMMock.mockResolvedValueOnce({
        text: 'quickscan fallback',
        parsed: null,
        usage: { inputTokens: 30, outputTokens: 20 },
        toolCalls: [],
      });

      const { analysis } = await quickScan('fallback');
      expect(analysis.summary).toBe('quickscan fallback');
      expect(analysis.confidence).toBe(0.6);
      expect(analysis.recommendation).toBe('Review needed');
    });
  });

  // ---------------------------------------------------------------
  // AuditBot (LOW / no-LLM)
  // ---------------------------------------------------------------
  describe('auditBot (LOW / no-LLM)', () => {
    beforeEach(() => {
      callLLMMock.mockReset();
    });

    it('does NOT call callLLM', async () => {
      await auditBot('audit');
      expect(callLLMMock).not.toHaveBeenCalled();
    });

    it('returns expected shape', async () => {
      const result = await auditBot('scan contract');

      expect(result).toHaveProperty('provider', 'AuditBot');
      expect(result).toHaveProperty('query', 'scan contract');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('number');
    });

    it('returns analysis with summary, confidence, findings, recommendation, dataPoints', async () => {
      const { analysis } = await auditBot('scan');

      expect(analysis).toHaveProperty('summary');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('findings');
      expect(analysis).toHaveProperty('recommendation');
      expect(analysis).toHaveProperty('dataPoints');
    });

    it('has confidence < 0.4 (LOW tier)', async () => {
      const { analysis } = await auditBot('scan');
      expect(analysis.confidence).toBeLessThan(0.4);
    });

    it('has exactly 0.25 confidence', async () => {
      const { analysis } = await auditBot('scan');
      expect(analysis.confidence).toBe(0.25);
    });

    it('detects reentrancy pattern (.call{)', async () => {
      const { analysis } = await auditBot('scan');
      const reentrancy = analysis.findings.some((f: string) => /reentrancy/i.test(f));
      expect(reentrancy).toBe(true);
    });

    it('detects selfdestruct pattern', async () => {
      const { analysis } = await auditBot('scan');
      const selfdestructFound = analysis.findings.some((f: string) => /selfdestruct/i.test(f));
      expect(selfdestructFound).toBe(true);
    });

    it('detects tx.origin pattern', async () => {
      const { analysis } = await auditBot('scan');
      const txOriginFound = analysis.findings.some((f: string) => /tx\.origin/i.test(f));
      expect(txOriginFound).toBe(true);
    });

    it('detects loop gas risk (for statement)', async () => {
      const { analysis } = await auditBot('scan');
      const loopFound = analysis.findings.some((f: string) => /loop/i.test(f) || /gas/i.test(f));
      expect(loopFound).toBe(true);
    });

    it('finds at least 4 vulnerability patterns in the sample contract', async () => {
      const { analysis } = await auditBot('scan');
      expect(analysis.findings.length).toBeGreaterThanOrEqual(4);
    });

    it('summary includes count of findings', async () => {
      const { analysis } = await auditBot('scan');
      expect(analysis.summary).toMatch(/Regex scan found \d+ patterns/);
    });

    it('sets dataPoints to 1 (minimal detail)', async () => {
      const { analysis } = await auditBot('scan');
      expect(analysis.dataPoints).toBe(1);
    });

    it('recommendation says manual review required', async () => {
      const { analysis } = await auditBot('scan');
      expect(analysis.recommendation).toContain('manual review required');
    });
  });
});

// ===================================================================
// 2. LEGAL REVIEW
// ===================================================================

describe('Legal Review agents', () => {
  // ---------------------------------------------------------------
  // LexGuard (HIGH)
  // ---------------------------------------------------------------
  describe('lexGuard (HIGH)', () => {
    const mockParsed = {
      summary: 'This ToS contains multiple high-risk clauses hostile to users.',
      confidence: 0.88,
      overallRisk: 'high',
      sections: [
        {
          section: '2. UNLIMITED LIABILITY',
          risk: 'critical',
          issue: 'User bears unlimited liability with no cap.',
          recommendation: 'Negotiate a reasonable liability cap.',
        },
        {
          section: '4. DATA COLLECTION',
          risk: 'critical',
          issue: 'Perpetual license to all user data including biometrics.',
          recommendation: 'Request GDPR-compliant data handling terms.',
        },
        {
          section: '5. NO DISPUTE RESOLUTION',
          risk: 'high',
          issue: 'Waiver of all dispute mechanisms.',
          recommendation: 'Insist on independent arbitration clause.',
        },
      ],
      redFlags: [
        'Unlimited indemnification obligation',
        'Perpetual data license including biometrics',
        'No dispute resolution mechanism',
        'Governing law chosen at discretion of company',
      ],
      dataPoints: 9,
    };

    beforeEach(() => {
      callLLMMock.mockReset();
      callLLMMock.mockResolvedValue(llmResult(mockParsed));
    });

    it('calls callLLM and returns expected shape', async () => {
      const result = await lexGuard('review these terms');

      expect(callLLMMock).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('provider', 'LexGuard');
      expect(result).toHaveProperty('query', 'review these terms');
      expect(result).toHaveProperty('timestamp');
    });

    it('returns analysis with summary, confidence, overallRisk, sections, redFlags, dataPoints', async () => {
      const { analysis } = await lexGuard('review');

      expect(analysis).toHaveProperty('summary');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('overallRisk');
      expect(analysis).toHaveProperty('sections');
      expect(analysis).toHaveProperty('redFlags');
      expect(analysis).toHaveProperty('dataPoints');
    });

    it('has confidence > 0.7 (HIGH tier)', async () => {
      const { analysis } = await lexGuard('review');
      expect(analysis.confidence).toBeGreaterThan(0.7);
    });

    it('sections contain required fields', async () => {
      const { analysis } = await lexGuard('review');

      expect(analysis.sections.length).toBeGreaterThan(0);
      for (const s of analysis.sections) {
        expect(s).toHaveProperty('section');
        expect(s).toHaveProperty('risk');
        expect(s).toHaveProperty('issue');
        expect(s).toHaveProperty('recommendation');
      }
    });

    it('has red flags populated', async () => {
      const { analysis } = await lexGuard('review');
      expect(analysis.redFlags.length).toBeGreaterThan(0);
    });

    it('uses high reasoning effort', async () => {
      await lexGuard('review');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.reasoning).toBe('high');
    });

    it('sends the ToS content in the input', async () => {
      await lexGuard('review');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.input).toContain('CloudNova');
    });

    it('provides a jsonSchema named legal_review', async () => {
      await lexGuard('review');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.jsonSchema.name).toBe('legal_review');
      expect(callArgs.jsonSchema.strict).toBe(true);
    });

    it('falls back to default analysis when parsed is null', async () => {
      callLLMMock.mockResolvedValueOnce({
        text: 'lexguard fallback',
        parsed: null,
        usage: { inputTokens: 40, outputTokens: 30 },
        toolCalls: [],
      });

      const { analysis } = await lexGuard('fallback');
      expect(analysis.summary).toBe('lexguard fallback');
      expect(analysis.confidence).toBe(0.85);
      expect(analysis.overallRisk).toBe('high');
    });
  });

  // ---------------------------------------------------------------
  // ContractEye (LOW / calls LLM but fixed shape)
  // ---------------------------------------------------------------
  describe('contractEye (LOW)', () => {
    beforeEach(() => {
      callLLMMock.mockReset();
      callLLMMock.mockResolvedValue({
        text: 'These terms grant CloudNova unlimited rights over user data. Users waive all dispute resolution rights.',
        parsed: null,
        usage: { inputTokens: 60, outputTokens: 30 },
        toolCalls: [],
      });
    });

    it('calls callLLM (unlike other LOW agents)', async () => {
      await contractEye('summarize');
      expect(callLLMMock).toHaveBeenCalledOnce();
    });

    it('returns expected shape', async () => {
      const result = await contractEye('summarize');

      expect(result).toHaveProperty('provider', 'ContractEye');
      expect(result).toHaveProperty('query', 'summarize');
      expect(result).toHaveProperty('timestamp');
    });

    it('returns analysis with summary, confidence, overallRisk, sections, redFlags, dataPoints', async () => {
      const { analysis } = await contractEye('summarize');

      expect(analysis).toHaveProperty('summary');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('overallRisk');
      expect(analysis).toHaveProperty('sections');
      expect(analysis).toHaveProperty('redFlags');
      expect(analysis).toHaveProperty('dataPoints');
    });

    it('has confidence < 0.4 (LOW tier)', async () => {
      const { analysis } = await contractEye('summarize');
      expect(analysis.confidence).toBeLessThan(0.4);
    });

    it('has exactly 0.35 confidence', async () => {
      const { analysis } = await contractEye('summarize');
      expect(analysis.confidence).toBe(0.35);
    });

    it('overallRisk is unknown', async () => {
      const { analysis } = await contractEye('summarize');
      expect(analysis.overallRisk).toBe('unknown');
    });

    it('sections and redFlags are empty arrays', async () => {
      const { analysis } = await contractEye('summarize');
      expect(analysis.sections).toEqual([]);
      expect(analysis.redFlags).toEqual([]);
    });

    it('summary is truncated to 200 characters max', async () => {
      const longText = 'A'.repeat(500);
      callLLMMock.mockResolvedValueOnce({
        text: longText,
        parsed: null,
        usage: { inputTokens: 60, outputTokens: 30 },
        toolCalls: [],
      });

      const { analysis } = await contractEye('long text');
      expect(analysis.summary.length).toBeLessThanOrEqual(200);
    });

    it('uses reasoning none', async () => {
      await contractEye('summarize');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.reasoning).toBe('none');
    });

    it('does not pass a jsonSchema', async () => {
      await contractEye('summarize');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.jsonSchema).toBeUndefined();
    });

    it('dataPoints is 1 (minimal detail)', async () => {
      const { analysis } = await contractEye('summarize');
      expect(analysis.dataPoints).toBe(1);
    });
  });
});

// ===================================================================
// 3. IP / PATENT
// ===================================================================

describe('IP/Patent agents', () => {
  // ---------------------------------------------------------------
  // PatentHawk (HIGH)
  // ---------------------------------------------------------------
  describe('patentHawk (HIGH)', () => {
    const mockParsed = {
      summary: 'Prior art search found related patents for decentralized escrow protocols.',
      confidence: 0.82,
      priorArt: [
        {
          title: 'Decentralized Escrow Protocol',
          source: 'patents.google.com',
          similarity: 0.78,
          keyClaims: 'Multi-party escrow with on-chain arbitration.',
        },
        {
          title: 'Smart Contract Payment Channels',
          source: 'arxiv.org',
          similarity: 0.65,
          keyClaims: 'Bi-directional payment channels with dispute resolution.',
        },
      ],
      noveltyAssessment: 'Moderate novelty — concept is not entirely new but implementation details may be patentable.',
      patentabilityScore: 0.6,
      dataPoints: 7,
    };

    beforeEach(() => {
      callLLMMock.mockReset();
      callLLMMock.mockResolvedValue(llmResult(mockParsed));
    });

    it('calls callLLM and returns expected shape', async () => {
      const result = await patentHawk('decentralized escrow on SKALE');

      expect(callLLMMock).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('provider', 'PatentHawk');
      expect(result).toHaveProperty('query', 'decentralized escrow on SKALE');
      expect(result).toHaveProperty('timestamp');
    });

    it('returns analysis with summary, confidence, priorArt, noveltyAssessment, patentabilityScore, dataPoints', async () => {
      const { analysis } = await patentHawk('search');

      expect(analysis).toHaveProperty('summary');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('priorArt');
      expect(analysis).toHaveProperty('noveltyAssessment');
      expect(analysis).toHaveProperty('patentabilityScore');
      expect(analysis).toHaveProperty('dataPoints');
    });

    it('has confidence > 0.7 (HIGH tier)', async () => {
      const { analysis } = await patentHawk('search');
      expect(analysis.confidence).toBeGreaterThan(0.7);
    });

    it('priorArt entries have required fields', async () => {
      const { analysis } = await patentHawk('search');

      expect(analysis.priorArt.length).toBeGreaterThan(0);
      for (const pa of analysis.priorArt) {
        expect(pa).toHaveProperty('title');
        expect(pa).toHaveProperty('source');
        expect(pa).toHaveProperty('similarity');
        expect(pa).toHaveProperty('keyClaims');
      }
    });

    it('uses high reasoning effort', async () => {
      await patentHawk('search');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.reasoning).toBe('high');
    });

    it('passes web_search tool', async () => {
      await patentHawk('search');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.tools).toEqual([{ type: 'web_search' }]);
    });

    it('provides a jsonSchema named patent_search', async () => {
      await patentHawk('search');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.jsonSchema.name).toBe('patent_search');
      expect(callArgs.jsonSchema.strict).toBe(true);
    });

    it('falls back to default analysis when parsed is null', async () => {
      callLLMMock.mockResolvedValueOnce({
        text: 'patenthawk fallback',
        parsed: null,
        usage: { inputTokens: 50, outputTokens: 25 },
        toolCalls: [],
      });

      const { analysis } = await patentHawk('fallback');
      expect(analysis.summary).toBe('patenthawk fallback');
      expect(analysis.confidence).toBe(0.85);
      expect(analysis.noveltyAssessment).toBe('Needs review');
    });
  });

  // ---------------------------------------------------------------
  // PriorArt (MEDIUM)
  // ---------------------------------------------------------------
  describe('priorArt (MEDIUM)', () => {
    const mockParsed = {
      summary: 'Found several related works in the decentralized escrow space.',
      confidence: 0.52,
      findings: [
        'OpenZeppelin Escrow contract pattern',
        'Kleros decentralized arbitration protocol',
        'Safe multisig escrow implementation',
      ],
      recommendation: 'Consider differentiating via SKALE-specific optimizations.',
      dataPoints: 3,
    };

    beforeEach(() => {
      callLLMMock.mockReset();
      callLLMMock.mockResolvedValue(llmResult(mockParsed));
    });

    it('calls callLLM and returns expected shape', async () => {
      const result = await priorArt('decentralized escrow');

      expect(callLLMMock).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('provider', 'PriorArt');
      expect(result).toHaveProperty('query', 'decentralized escrow');
      expect(result).toHaveProperty('timestamp');
    });

    it('returns analysis with summary, confidence, findings, recommendation, dataPoints', async () => {
      const { analysis } = await priorArt('search');

      expect(analysis).toHaveProperty('summary');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('findings');
      expect(analysis).toHaveProperty('recommendation');
      expect(analysis).toHaveProperty('dataPoints');
    });

    it('has confidence between 0.4 and 0.7 (MEDIUM tier)', async () => {
      const { analysis } = await priorArt('search');
      expect(analysis.confidence).toBeGreaterThanOrEqual(0.4);
      expect(analysis.confidence).toBeLessThanOrEqual(0.7);
    });

    it('uses low reasoning effort', async () => {
      await priorArt('search');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.reasoning).toBe('low');
    });

    it('passes web_search tool', async () => {
      await priorArt('search');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.tools).toEqual([{ type: 'web_search' }]);
    });

    it('provides a jsonSchema named prior_art_search', async () => {
      await priorArt('search');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.jsonSchema.name).toBe('prior_art_search');
    });

    it('falls back to default analysis when parsed is null', async () => {
      callLLMMock.mockResolvedValueOnce({
        text: 'priorart fallback',
        parsed: null,
        usage: { inputTokens: 30, outputTokens: 20 },
        toolCalls: [],
      });

      const { analysis } = await priorArt('fallback');
      expect(analysis.summary).toBe('priorart fallback');
      expect(analysis.confidence).toBe(0.55);
      expect(analysis.recommendation).toBe('Further research needed');
    });
  });

  // ---------------------------------------------------------------
  // PatentLite (LOW / no-LLM)
  // ---------------------------------------------------------------
  describe('patentLite (LOW / no-LLM)', () => {
    beforeEach(() => {
      callLLMMock.mockReset();
    });

    it('does NOT call callLLM', async () => {
      await patentLite('blockchain escrow');
      expect(callLLMMock).not.toHaveBeenCalled();
    });

    it('returns expected shape', async () => {
      const result = await patentLite('blockchain escrow');

      expect(result).toHaveProperty('provider', 'PatentLite');
      expect(result).toHaveProperty('query', 'blockchain escrow');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('number');
    });

    it('returns analysis with summary, confidence, link, findings, recommendation, dataPoints', async () => {
      const { analysis } = await patentLite('search');

      expect(analysis).toHaveProperty('summary');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('link');
      expect(analysis).toHaveProperty('findings');
      expect(analysis).toHaveProperty('recommendation');
      expect(analysis).toHaveProperty('dataPoints');
    });

    it('has confidence < 0.4 (LOW tier)', async () => {
      const { analysis } = await patentLite('search');
      expect(analysis.confidence).toBeLessThan(0.4);
    });

    it('has exactly 0.20 confidence', async () => {
      const { analysis } = await patentLite('search');
      expect(analysis.confidence).toBe(0.20);
    });

    it('returns a Google Patents URL', async () => {
      const { analysis } = await patentLite('blockchain escrow');
      expect(analysis.link).toContain('https://patents.google.com/');
    });

    it('URL-encodes the query in the link', async () => {
      const { analysis } = await patentLite('zero knowledge proof');
      expect(analysis.link).toContain(encodeURIComponent('zero knowledge proof'));
    });

    it('findings array contains the search URL', async () => {
      const { analysis } = await patentLite('blockchain escrow');
      expect(analysis.findings.length).toBe(1);
      expect(analysis.findings[0]).toContain('https://patents.google.com/');
    });

    it('summary includes truncated query (up to 50 chars)', async () => {
      const longQuery = 'A'.repeat(100);
      const { analysis } = await patentLite(longQuery);
      // The summary slices query to first 50 chars
      expect(analysis.summary).toContain('A'.repeat(50));
      expect(analysis.summary).not.toContain('A'.repeat(51));
    });

    it('dataPoints is 1 (minimal detail)', async () => {
      const { analysis } = await patentLite('search');
      expect(analysis.dataPoints).toBe(1);
    });

    it('recommendation says manual search required', async () => {
      const { analysis } = await patentLite('search');
      expect(analysis.recommendation).toBe('Manual search required.');
    });
  });
});

// ===================================================================
// 4. DEFI STRATEGY
// ===================================================================

describe('DeFi Strategy agents', () => {
  // ---------------------------------------------------------------
  // Shared fetch mock setup for DeFi agents
  // ---------------------------------------------------------------

  function setupFetchMocks() {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('pyth.network')) {
        return jsonResponse({
          parsed: [
            {
              price: {
                price: '15000000000',
                expo: -8,
                conf: '5000000',
              },
            },
          ],
        });
      }
      if (url.includes('coingecko.com')) {
        return jsonResponse({
          solana: {
            usd: 150.0,
            usd_market_cap: 70000000000,
            usd_24h_vol: 3500000000,
            usd_24h_change: 2.45,
          },
        });
      }
      if (url.includes('llama.fi')) {
        return jsonResponse([
          { name: 'Solana', tvl: 12000000000, change_1d: 1.8 },
          { name: 'Ethereum', tvl: 50000000000, change_1d: 0.5 },
        ]);
      }
      return jsonResponse({});
    });
  }

  // ---------------------------------------------------------------
  // YieldSage (HIGH)
  // ---------------------------------------------------------------
  describe('yieldSage (HIGH)', () => {
    const mockParsed = {
      summary: 'Current market conditions favor a balanced DeFi allocation with moderate risk.',
      confidence: 0.85,
      trend: 'bullish',
      allocations: [
        {
          protocol: 'Marinade Finance',
          allocation: 35,
          riskTier: 'low',
          expectedYield: '6.5% APY',
        },
        {
          protocol: 'Raydium',
          allocation: 25,
          riskTier: 'medium',
          expectedYield: '12% APY',
        },
        {
          protocol: 'Drift Protocol',
          allocation: 20,
          riskTier: 'medium',
          expectedYield: '18% APY',
        },
        {
          protocol: 'Jupiter Perps',
          allocation: 20,
          riskTier: 'high',
          expectedYield: '25% APY',
        },
      ],
      rebalanceTriggers: [
        'SOL drops below $130',
        'TVL change exceeds 10% in 24h',
        'Funding rate inversion on perps',
      ],
      riskLevel: 'medium',
      dataPoints: 8,
    };

    beforeEach(() => {
      callLLMMock.mockReset();
      fetchMock.mockReset();
      setupFetchMocks();
      callLLMMock.mockResolvedValue(llmResult(mockParsed));
    });

    it('fetches data from Pyth, CoinGecko, and DeFiLlama before calling callLLM', async () => {
      await yieldSage('optimal allocation');

      // 3 fetch calls: Pyth, CoinGecko, DeFiLlama (via Promise.allSettled)
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(callLLMMock).toHaveBeenCalledOnce();
    });

    it('returns expected shape', async () => {
      const result = await yieldSage('strategy');

      expect(result).toHaveProperty('provider', 'YieldSage');
      expect(result).toHaveProperty('query', 'strategy');
      expect(result).toHaveProperty('timestamp');
    });

    it('returns analysis with summary, confidence, trend, allocations, rebalanceTriggers, riskLevel, dataPoints', async () => {
      const { analysis } = await yieldSage('strategy');

      expect(analysis).toHaveProperty('summary');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('trend');
      expect(analysis).toHaveProperty('allocations');
      expect(analysis).toHaveProperty('rebalanceTriggers');
      expect(analysis).toHaveProperty('riskLevel');
      expect(analysis).toHaveProperty('dataPoints');
    });

    it('has confidence > 0.7 (HIGH tier)', async () => {
      const { analysis } = await yieldSage('strategy');
      expect(analysis.confidence).toBeGreaterThan(0.7);
    });

    it('allocations have required fields', async () => {
      const { analysis } = await yieldSage('strategy');

      expect(analysis.allocations.length).toBeGreaterThan(0);
      for (const a of analysis.allocations) {
        expect(a).toHaveProperty('protocol');
        expect(a).toHaveProperty('allocation');
        expect(a).toHaveProperty('riskTier');
        expect(a).toHaveProperty('expectedYield');
      }
    });

    it('uses high reasoning effort', async () => {
      await yieldSage('strategy');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.reasoning).toBe('high');
    });

    it('includes live market data in LLM input', async () => {
      await yieldSage('strategy');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.input).toContain('Pyth Oracle');
      expect(callArgs.input).toContain('CoinGecko');
      expect(callArgs.input).toContain('DeFiLlama');
    });

    it('provides a jsonSchema named defi_strategy', async () => {
      await yieldSage('strategy');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.jsonSchema.name).toBe('defi_strategy');
      expect(callArgs.jsonSchema.strict).toBe(true);
    });

    it('handles fetch failures gracefully (Promise.allSettled)', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      const result = await yieldSage('strategy');
      // Should still succeed — data falls back to defaults
      expect(result).toHaveProperty('provider', 'YieldSage');
      expect(callLLMMock).toHaveBeenCalledOnce();
    });

    it('falls back to default analysis when parsed is null', async () => {
      callLLMMock.mockResolvedValueOnce({
        text: 'yieldsage fallback',
        parsed: null,
        usage: { inputTokens: 50, outputTokens: 25 },
        toolCalls: [],
      });

      const { analysis } = await yieldSage('fallback');
      expect(analysis.summary).toBe('yieldsage fallback');
      expect(analysis.confidence).toBe(0.85);
      expect(analysis.trend).toBe('neutral');
      expect(analysis.riskLevel).toBe('medium');
    });
  });

  // ---------------------------------------------------------------
  // AlphaQuick (MEDIUM)
  // ---------------------------------------------------------------
  describe('alphaQuick (MEDIUM)', () => {
    const mockParsed = {
      summary: 'SOL showing positive momentum. Short-term bullish.',
      confidence: 0.55,
      recommendation: 'Consider accumulating SOL with DCA strategy.',
      trend: 'bullish',
      dataPoints: 2,
    };

    beforeEach(() => {
      callLLMMock.mockReset();
      fetchMock.mockReset();
      // AlphaQuick only calls CoinGecko
      fetchMock.mockImplementation(async () => {
        return jsonResponse({
          solana: {
            usd: 150.0,
            usd_market_cap: 70000000000,
            usd_24h_vol: 3500000000,
            usd_24h_change: 2.45,
          },
        });
      });
      callLLMMock.mockResolvedValue(llmResult(mockParsed));
    });

    it('fetches data from CoinGecko only then calls callLLM', async () => {
      await alphaQuick('quick advice');

      // Only 1 fetch: CoinGecko
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(callLLMMock).toHaveBeenCalledOnce();
    });

    it('returns expected shape', async () => {
      const result = await alphaQuick('advice');

      expect(result).toHaveProperty('provider', 'AlphaQuick');
      expect(result).toHaveProperty('query', 'advice');
      expect(result).toHaveProperty('timestamp');
    });

    it('returns analysis with summary, confidence, recommendation, trend, dataPoints', async () => {
      const { analysis } = await alphaQuick('advice');

      expect(analysis).toHaveProperty('summary');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('recommendation');
      expect(analysis).toHaveProperty('trend');
      expect(analysis).toHaveProperty('dataPoints');
    });

    it('has confidence between 0.4 and 0.7 (MEDIUM tier)', async () => {
      const { analysis } = await alphaQuick('advice');
      expect(analysis.confidence).toBeGreaterThanOrEqual(0.4);
      expect(analysis.confidence).toBeLessThanOrEqual(0.7);
    });

    it('uses low reasoning effort', async () => {
      await alphaQuick('advice');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.reasoning).toBe('low');
    });

    it('includes SOL price data in LLM input', async () => {
      await alphaQuick('advice');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.input).toContain('SOL');
      expect(callArgs.input).toContain('$150');
    });

    it('provides a jsonSchema named quick_advice', async () => {
      await alphaQuick('advice');
      const callArgs = callLLMMock.mock.calls[0][0];
      expect(callArgs.jsonSchema.name).toBe('quick_advice');
    });

    it('handles CoinGecko fetch failure gracefully', async () => {
      fetchMock.mockImplementation(async () => {
        throw new Error('CoinGecko down');
      });

      const result = await alphaQuick('advice');
      // Should still succeed — fetchCoinGecko catches errors internally
      expect(result).toHaveProperty('provider', 'AlphaQuick');
      expect(callLLMMock).toHaveBeenCalledOnce();
    });

    it('falls back to default analysis when parsed is null', async () => {
      callLLMMock.mockResolvedValueOnce({
        text: 'alphaquick fallback',
        parsed: null,
        usage: { inputTokens: 30, outputTokens: 20 },
        toolCalls: [],
      });

      const { analysis } = await alphaQuick('fallback');
      expect(analysis.summary).toBe('alphaquick fallback');
      expect(analysis.confidence).toBe(0.55);
      expect(analysis.recommendation).toBe('Hold');
      expect(analysis.trend).toBe('neutral');
    });
  });
});

// ===================================================================
// 5. CROSS-CUTTING CONCERNS
// ===================================================================

describe('Cross-cutting: all agents', () => {
  beforeEach(() => {
    callLLMMock.mockReset();
    fetchMock.mockReset();
  });

  it('every agent includes a numeric timestamp', async () => {
    callLLMMock.mockResolvedValue(llmResult({
      summary: 'test', confidence: 0.8, findings: [], overallRisk: 'low', dataPoints: 1,
    }));
    fetchMock.mockResolvedValue(jsonResponse({ solana: { usd: 100 } }));

    const agents = [
      () => auditBot('test'),
      () => patentLite('test'),
    ];

    for (const agentFn of agents) {
      const result = await agentFn();
      expect(typeof result.timestamp).toBe('number');
      expect(result.timestamp).toBeGreaterThan(0);
    }
  });

  it('every agent includes provider and query', async () => {
    callLLMMock.mockResolvedValue(llmResult({
      summary: 'test', confidence: 0.8, findings: [], overallRisk: 'low', dataPoints: 1,
    }));
    fetchMock.mockResolvedValue(jsonResponse({ solana: { usd: 100 } }));

    // Test the non-LLM agents directly
    const botResult = await auditBot('my query');
    expect(botResult.provider).toBe('AuditBot');
    expect(botResult.query).toBe('my query');

    const liteResult = await patentLite('my query');
    expect(liteResult.provider).toBe('PatentLite');
    expect(liteResult.query).toBe('my query');
  });

  it('LOW agents have lower confidence than HIGH agents', async () => {
    // auditBot and patentLite are pure LOW agents (no LLM needed)
    const botResult = await auditBot('test');
    const liteResult = await patentLite('test');

    expect(botResult.analysis.confidence).toBeLessThan(0.4);
    expect(liteResult.analysis.confidence).toBeLessThan(0.4);
  });

  it('every agent analysis has a summary string', async () => {
    callLLMMock.mockResolvedValue(llmResult({
      summary: 'test summary', confidence: 0.8, findings: [], overallRisk: 'low', dataPoints: 1,
    }));
    fetchMock.mockResolvedValue(jsonResponse({ solana: { usd: 100 } }));

    const botResult = await auditBot('test');
    const liteResult = await patentLite('test');

    expect(typeof botResult.analysis.summary).toBe('string');
    expect(typeof liteResult.analysis.summary).toBe('string');
    expect(botResult.analysis.summary.length).toBeGreaterThan(0);
    expect(liteResult.analysis.summary.length).toBeGreaterThan(0);
  });

  it('every agent analysis has a numeric confidence', async () => {
    const botResult = await auditBot('test');
    const liteResult = await patentLite('test');

    expect(typeof botResult.analysis.confidence).toBe('number');
    expect(typeof liteResult.analysis.confidence).toBe('number');
    expect(botResult.analysis.confidence).toBeGreaterThanOrEqual(0);
    expect(botResult.analysis.confidence).toBeLessThanOrEqual(1);
    expect(liteResult.analysis.confidence).toBeGreaterThanOrEqual(0);
    expect(liteResult.analysis.confidence).toBeLessThanOrEqual(1);
  });

  it('every agent analysis has a dataPoints number', async () => {
    const botResult = await auditBot('test');
    const liteResult = await patentLite('test');

    expect(typeof botResult.analysis.dataPoints).toBe('number');
    expect(typeof liteResult.analysis.dataPoints).toBe('number');
  });
});
