// AP2 — Agent Payments Protocol mandate tracking.
// Provides an accountability layer over the escrow lifecycle.
// Each agent run produces a MandateChain: Intent → Cart[] → Payment[]

export interface AP2Mandate {
  id: string;
  type: 'intent' | 'cart' | 'payment';
  timestamp: number;
  parentId?: string;
  expiresAt?: number;
  metadata?: Record<string, any>;
}

export interface IntentMandate extends AP2Mandate {
  type: 'intent';
  description: string;
  budget: { amount: string; asset: string };
  ttl: number;
  allowedProviders?: string[];
  constraints?: Record<string, any>;
}

export interface CartMandate extends AP2Mandate {
  type: 'cart';
  provider: string;
  providerName: string;
  items: Array<{
    service: string;
    price: { amount: string; asset: string };
    description: string;
  }>;
  totalPrice: { amount: string; asset: string };
  x402Endpoint: string;
  providerSignature?: string;
}

export interface PaymentMandate extends AP2Mandate {
  type: 'payment';
  escrowId: string;
  txHash: string;
  amount: { amount: string; asset: string };
  provider: string;
  status: 'locked' | 'released' | 'refunded';
  x402Cost?: string;
  settlementTxHash?: string;
}

export interface MandateChain {
  chainId: string;
  mandates: AP2Mandate[];
  created: number;
  completed?: number;
  outcome?: 'success' | 'failure' | 'expired';
}

function mandateId(): string {
  return `mandate_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export class MandateTracker {
  private chain: MandateChain;
  private intentMandate: IntentMandate | null = null;

  constructor() {
    this.chain = {
      chainId: `chain_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      mandates: [],
      created: Date.now(),
    };
  }

  createIntent(params: {
    description: string;
    budget: string;
    asset: string;
    ttl?: number;
    allowedProviders?: string[];
  }): IntentMandate {
    const intent: IntentMandate = {
      id: mandateId(),
      type: 'intent',
      timestamp: Date.now(),
      description: params.description,
      budget: { amount: params.budget, asset: params.asset },
      ttl: params.ttl ?? 300,
      allowedProviders: params.allowedProviders,
      expiresAt: Date.now() + (params.ttl ?? 300) * 1000,
    };
    this.intentMandate = intent;
    this.chain.mandates.push(intent);
    return intent;
  }

  createCart(params: {
    provider: string;
    providerName: string;
    price: string;
    asset: string;
    service: string;
    x402Endpoint: string;
  }): CartMandate {
    if (!this.intentMandate) throw new Error('Must create intent before cart');

    const cart: CartMandate = {
      id: mandateId(),
      type: 'cart',
      timestamp: Date.now(),
      parentId: this.intentMandate.id,
      provider: params.provider,
      providerName: params.providerName,
      items: [{
        service: params.service,
        price: { amount: params.price, asset: params.asset },
        description: `${params.providerName} ${params.service}`,
      }],
      totalPrice: { amount: params.price, asset: params.asset },
      x402Endpoint: params.x402Endpoint,
    };
    this.chain.mandates.push(cart);
    return cart;
  }

  createPayment(params: {
    cartId: string;
    escrowId: number;
    txHash: string;
    amount: string;
    asset: string;
    provider: string;
    x402Cost?: string;
  }): PaymentMandate {
    const payment: PaymentMandate = {
      id: mandateId(),
      type: 'payment',
      timestamp: Date.now(),
      parentId: params.cartId,
      escrowId: String(params.escrowId),
      txHash: params.txHash,
      amount: { amount: params.amount, asset: params.asset },
      provider: params.provider,
      status: 'locked',
      x402Cost: params.x402Cost,
    };
    this.chain.mandates.push(payment);
    return payment;
  }

  settlePayment(paymentId: string, outcome: 'released' | 'refunded', txHash: string) {
    const payment = this.chain.mandates.find(
      m => m.id === paymentId && m.type === 'payment'
    ) as PaymentMandate | undefined;
    if (payment) {
      payment.status = outcome;
      payment.settlementTxHash = txHash;
    }
  }

  complete(outcome: 'success' | 'failure' | 'expired') {
    this.chain.completed = Date.now();
    this.chain.outcome = outcome;
  }

  getChain(): MandateChain {
    return this.chain;
  }

  getByType<T extends AP2Mandate>(type: 'intent' | 'cart' | 'payment'): T[] {
    return this.chain.mandates.filter(m => m.type === type) as T[];
  }
}
