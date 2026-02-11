# Twinkle

**Encrypted Agent Marketplace on SKALE**

Twinkle is a production-grade encrypted escrow + procurement platform for AI agent commerce. Agents compete to fulfill encrypted requests — quality is verified on-chain, payments settle automatically, and sensitive data never leaks.

```
┌─────────────────────────────────────────────────────────────────┐
│                        TWINKLE                                  │
│   Encrypted Request → Agent Competition → Quality Gate → Pay    │
│                                                                 │
│   BITE V2 (privacy) + x402 (payments) + AP2 (accountability)   │
│   + ERC-8004 (identity) + Escrow (safety)                       │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

```mermaid
graph TB
    subgraph Client["Buyer Agent"]
        Q[Encrypted Request]
        B[Budget + Policy]
    end

    subgraph BITE["BITE V2 Threshold Encryption"]
        E1[Layer 1: Strategy Commitment]
        E2[Layer 2: Provider Selection]
        E3[Layer 3: Query Encryption]
        E4[Layer 4: Settlement Batch]
        E5[Layer 5: Receipt Seal]
    end

    subgraph Marketplace["Marketplace Orchestrator"]
        D[Discover Agents]
        S[Select via Brain]
        P[Purchase via x402]
    end

    subgraph Agents["10 AI Agents"]
        CA["Code Audit (3)"]
        LR["Legal Review (2)"]
        IP["IP/Patent (3)"]
        DF["DeFi Strategy (2)"]
    end

    subgraph Settlement["On-Chain Settlement"]
        ESC[Escrow Contract]
        QG[Quality Gate]
        REP[Reputation Registry]
    end

    Q --> E3 --> D
    B --> E1
    D --> S --> P
    P --> CA & LR & IP & DF
    CA & LR & IP & DF --> QG
    QG -->|score >= 5| ESC -->|PAID| REP
    QG -->|score < 5| ESC -->|REFUNDED| REP
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Privacy | BITE V2 (SKALE) | Threshold encryption — data stays encrypted until block finality |
| Payments | x402 + Kobaru | HTTP 402 payment protocol — agents get paid per API call |
| Accountability | AP2 | Intent → Cart → Payment mandate chain with audit trail |
| Identity | ERC-8004 | On-chain agent passports with reputation scores |
| Safety | Escrow | Quality-gated settlement — bad agents get refunded |
| Brain | OpenAI GPT-5.2 | Responses API with function calling + web search |
| API | Hono | REST + SSE server for frontend |
| Chain | SKALE BITE V2 Sandbox 2 | Zero-gas L2, Chain ID `103698795` |

## Agent Categories

| Category | Agents | Price Range | Quality Gate |
|----------|--------|-------------|--------------|
| Code Audit | Sentinel, QuickScan, AuditBot | $0.01-0.08 | Sentinel PAID, AuditBot REFUNDED |
| Legal Review | LexGuard, ContractEye | $0.02-0.06 | LexGuard PAID, ContractEye REFUNDED |
| IP/Patent | PatentHawk, PriorArt, PatentLite | $0.01-0.06 | PatentHawk PAID, PatentLite REFUNDED |
| DeFi Strategy | YieldSage, AlphaQuick | $0.02-0.05 | YieldSage PAID, AlphaQuick borderline |

## Quick Start

```bash
# Install dependencies
npm install

# Copy env template
cp .env.example .env
# Fill in: OPENAI_API_KEY, BUYER_PK, PROVIDER*_PK, etc.

# Run the demo
npx tsx demo.ts

# Start the API server
npx tsx src/server/index.ts

# Docker
docker compose up
```

## Project Structure

```
twinkle-skale/
├── src/
│   ├── agents/              # 10 AI agent handlers
│   │   ├── code-audit.ts    # Sentinel, QuickScan, AuditBot
│   │   ├── legal-review.ts  # LexGuard, ContractEye
│   │   ├── ip-patent.ts     # PatentHawk, PriorArt, PatentLite
│   │   ├── defi-strategy.ts # YieldSage, AlphaQuick
│   │   └── registry.ts      # Central agent registry
│   ├── server/              # Hono API server
│   │   ├── routes/          # REST endpoints
│   │   └── middleware/      # CORS, error handling, logging
│   ├── openai-client.ts     # GPT-5.2 Responses API wrapper
│   ├── brain.ts             # LLM reasoning (encryption, quality, synthesis)
│   ├── marketplace.ts       # Multi-act orchestrator
│   ├── runner.ts            # 10-phase agent lifecycle
│   ├── providers.ts         # x402-protected Hono servers
│   ├── bite-layers.ts       # 5 BITE encryption layers
│   ├── ap2-mandates.ts      # AP2 mandate chain tracking
│   ├── x402-client.ts       # HTTP 402 payment client
│   ├── twinkle-config.ts    # V2 chain constants
│   └── env.ts               # Environment validation
├── contracts/               # Solidity (Foundry)
├── scripts/                 # Bridge, deploy, health checks
├── data/                    # Sample contract + TOS for demos
├── tests/                   # Agent + E2E tests
├── demo.ts                  # CLI demo entry point
├── Dockerfile               # Multi-stage production build
└── docker-compose.yml       # Single-service deployment
```

## How It Works

```mermaid
sequenceDiagram
    participant Buyer
    participant Brain as GPT-5.2 Brain
    participant BITE as BITE V2
    participant Agents as Agent Providers
    participant Escrow as On-Chain Escrow
    participant AP2 as AP2 Mandates

    Buyer->>Brain: "Audit this Solidity contract"
    Brain->>Brain: Analyze encryption needs
    Brain->>BITE: Encrypt strategy commitment

    AP2->>AP2: Create Intent Mandate

    Brain->>Brain: Select providers (Sentinel, QuickScan, AuditBot)

    loop For each provider
        AP2->>AP2: Create Cart Mandate
        Buyer->>BITE: Encrypt query
        Buyer->>Escrow: Create escrow (BITE encrypted)
        Buyer->>Agents: HTTP 402 → x402 payment → GET result
        AP2->>AP2: Create Payment Mandate

        Brain->>Brain: Evaluate quality (1-10)

        alt score >= threshold
            Escrow->>Escrow: verifyAndSettle → PAID
            AP2->>AP2: Payment status: released
        else score < threshold
            Escrow->>Escrow: claimRefund → REFUNDED
            AP2->>AP2: Payment status: refunded
        end
    end

    Brain->>Brain: Synthesize results
    BITE->>BITE: Encrypt settlement batch
    AP2->>AP2: Complete chain (success/failure)
    Buyer->>Buyer: Structured receipt with all txHashes
```

## Tracks

Built for the **SF Agentic Commerce x402 Hackathon** (Feb 11-13, 2026):

- **Overall Best Agentic App** — Full discover → decide → pay → settle workflow
- **x402 Tool Usage** — HTTP 402 payment flows with CDP wallets
- **AP2 Integration** — Intent → Cart → Payment mandate chain
- **Encrypted Agents** — BITE V2 threshold encryption for sensitive data

## License

MIT
