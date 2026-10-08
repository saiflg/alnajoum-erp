/**
 * Priority engine. A transparent weighted score, not a model's opinion: every factor is a number from real data,
 * and the factors that produced the score are returned so a person can see why one issue outranks another.
 */
export interface PriorityFactors {
  /** Hours until the thing that makes it urgent (departure, deadline, expiry). Undefined = no deadline. */
  hoursToDeadline?: number;
  /** 0–3: none, one customer, several, many / group. */
  customerImpact: 0 | 1 | 2 | 3;
  /** Amount at stake in the company's currency (whole units). */
  financialImpact?: number;
  /** 0–3: none … legal/regulatory exposure (visa rules, unpaid supplier with penalties). */
  regulatoryImpact: 0 | 1 | 2 | 3;
  /** 0–2: nothing waits on it … many things wait on it (e.g. a group manifest). */
  dependency: 0 | 1 | 2;
  /** 0–3: how much worse it gets if ignored (security, money loss). */
  risk: 0 | 1 | 2 | 3;
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface PriorityResult {
  score: number; // 0–100
  severity: Severity;
  breakdown: Record<string, number>;
}

const urgency = (hours: number | undefined): number => {
  if (hours === undefined) return 0;
  if (hours <= 0) return 40; // already late
  if (hours <= 24) return 38;
  if (hours <= 72) return 30;
  if (hours <= 24 * 7) return 18;
  if (hours <= 24 * 30) return 8;
  return 2;
};

const money = (amount: number | undefined): number => {
  if (!amount || amount <= 0) return 0;
  if (amount >= 5_000_000) return 15;
  if (amount >= 1_000_000) return 12;
  if (amount >= 250_000) return 8;
  if (amount >= 50_000) return 5;
  return 2;
};

export function scorePriority(f: PriorityFactors): PriorityResult {
  const breakdown = {
    urgency: urgency(f.hoursToDeadline),
    customerImpact: f.customerImpact * 5,
    financialImpact: money(f.financialImpact),
    regulatoryImpact: f.regulatoryImpact * 4,
    dependency: f.dependency * 3,
    risk: f.risk * 4,
  };
  const score = Math.min(
    100,
    Object.values(breakdown).reduce((a, b) => a + b, 0),
  );
  const severity: Severity =
    score >= 60
      ? 'CRITICAL'
      : score >= 40
        ? 'HIGH'
        : score >= 20
          ? 'MEDIUM'
          : 'LOW';
  return { score, severity, breakdown };
}
