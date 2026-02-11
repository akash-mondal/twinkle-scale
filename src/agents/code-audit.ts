// Code Audit agents — Sentinel (HIGH), QuickScan (MEDIUM), AuditBot (LOW)
import { callLLM } from '../openai-client.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_CONTRACT = readFileSync(resolve(__dirname, '../../data/sample-contract.sol'), 'utf-8');

// Sentinel — Expert auditor with function calling, HIGH quality
export async function sentinel(query: string): Promise<any> {
  const contractSource = SAMPLE_CONTRACT;

  const result = await callLLM({
    instructions: `You are an expert Solidity security auditor performing a comprehensive multi-pass analysis.

For each vulnerability found, analyze it thoroughly and include:
- Vulnerability type (reentrancy, access_control, overflow, gas, logic, tx_origin)
- Severity (critical, high, medium, low, info)
- Affected line range
- Description of the vulnerability
- Recommended fix

Be thorough. Check for: reentrancy, access control issues, integer overflow/underflow, gas optimization, logic bugs, tx.origin misuse, selfdestruct risks, and unchecked returns.`,
    input: `Audit this Solidity contract for security vulnerabilities:\n\n${contractSource}\n\nUser query: ${query}`,
    reasoning: 'high',
    jsonSchema: {
      name: 'audit_report',
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          confidence: { type: 'number' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                vulnType: { type: 'string' },
                severity: { type: 'string' },
                lineRange: { type: 'string' },
                description: { type: 'string' },
                recommendation: { type: 'string' },
              },
              required: ['vulnType', 'severity', 'lineRange', 'description', 'recommendation'],
              additionalProperties: false,
            },
          },
          overallRisk: { type: 'string' },
          dataPoints: { type: 'number' },
        },
        required: ['summary', 'confidence', 'findings', 'overallRisk', 'dataPoints'],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  return {
    provider: 'Sentinel',
    query,
    analysis: result.parsed || { summary: result.text, confidence: 0.85, findings: [], overallRisk: 'medium', dataPoints: 5 },
    timestamp: Date.now(),
  };
}

// QuickScan — Simpler analysis, MEDIUM quality
export async function quickScan(query: string): Promise<any> {
  const contractSource = SAMPLE_CONTRACT;

  const result = await callLLM({
    instructions: 'You are a Solidity security scanner. Do a quick pass for the top 3 most critical vulnerability types only. Be concise.',
    input: `Quick scan this contract:\n\n${contractSource}\n\nQuery: ${query}`,
    reasoning: 'low',
    jsonSchema: {
      name: 'quick_scan',
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          confidence: { type: 'number' },
          topVulnerabilities: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
          dataPoints: { type: 'number' },
        },
        required: ['summary', 'confidence', 'topVulnerabilities', 'recommendation', 'dataPoints'],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  return {
    provider: 'QuickScan',
    query,
    analysis: result.parsed || { summary: result.text, confidence: 0.6, topVulnerabilities: [], recommendation: 'Review needed', dataPoints: 3 },
    timestamp: Date.now(),
  };
}

// AuditBot — Regex only, NO LLM, LOW quality → designed to fail quality gate
export async function auditBot(query: string): Promise<any> {
  const contractSource = SAMPLE_CONTRACT;
  const findings: string[] = [];

  if (/\.call\{/.test(contractSource) || /\.call\.value/.test(contractSource)) findings.push('Potential reentrancy: external call detected');
  if (/selfdestruct/.test(contractSource)) findings.push('Dangerous: selfdestruct found');
  if (/tx\.origin/.test(contractSource)) findings.push('Auth bypass risk: tx.origin used');
  if (/for\s*\(/.test(contractSource)) findings.push('Gas risk: loop detected');

  return {
    provider: 'AuditBot',
    query,
    analysis: {
      summary: `Regex scan found ${findings.length} patterns.`,
      confidence: 0.25,
      findings: findings.map(f => f),
      recommendation: 'Automated scan only — manual review required.',
      dataPoints: 1,
    },
    timestamp: Date.now(),
  };
}
