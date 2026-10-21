export type Subject =
  | { kind: "STATUS" }
  | { kind: "RESPONSE_TIME" }
  | { kind: "BODY"; path: Array<string | number> }
  | { kind: "HEADER"; name: string }
  | { kind: "CERTIFICATE_EXPIRATION" }
  | { kind: "DOMAIN_EXPIRATION" }
  | { kind: "CONNECTED" }
  | { kind: "IP" };

export type Operator = "==" | "!=" | "<" | "<=" | ">" | ">=" | "contains" | "!contains" | "matches" | "!matches";

export type Literal = { type: "number"; value: number } | { type: "string"; value: string } | { type: "boolean"; value: boolean } | { type: "null" };
export type Operand = Literal | { type: "any"; values: Literal[] } | { type: "regex"; pattern: string; flags: string };

export type Assertion = { expr: string; subject: Subject; op: Operator; operand: Operand };

export type AssertionContext = {
  status?: number;
  responseTimeMs?: number;
  body?: string;
  headers?: Record<string, string | string[] | undefined>;
  certExpiresInMs?: number | null;
  domainExpiresInMs?: number | null;
  connected?: boolean;
  ip?: string;
};

export type ParseResult = { ok: true; assertion: Assertion } | { ok: false; error: string };
