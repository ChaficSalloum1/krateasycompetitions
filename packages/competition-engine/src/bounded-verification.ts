import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export type VerificationStatus = "CERTIFIED" | "REJECTED" | "UNKNOWN";
export type VerificationValue = null | boolean | number | string | readonly VerificationValue[] | { readonly [key: string]: VerificationValue };
export type VerificationInput = Readonly<Record<string, VerificationValue>>;

export interface VerificationDimension {
  readonly name: string;
  readonly values: readonly VerificationValue[];
}

export interface VerificationInvariant<Output> {
  readonly id: string;
  check(input: VerificationInput, output: Output): readonly string[];
}

export interface VerificationTransformation<Output> {
  readonly id: string;
  transform(input: VerificationInput): VerificationInput;
  compare(context: {
    input: VerificationInput;
    output: Output;
    transformedInput: VerificationInput;
    transformedOutput: Output;
  }): readonly string[];
}

export interface BoundedVerificationRequest<Output> {
  readonly id: string;
  readonly dimensions: readonly VerificationDimension[];
  readonly maxCases: number;
  execute(input: VerificationInput): Output;
  readonly invariants: readonly VerificationInvariant<Output>[];
  readonly transformations?: readonly VerificationTransformation<Output>[];
}

export interface MetamorphicProof {
  readonly transformationId: string;
  readonly transformedInputHash: string;
  readonly transformedOutputHash?: string;
  readonly status: "PASSED" | "FAILED" | "UNKNOWN";
  readonly violations: readonly string[];
}

export interface VerifiedCase {
  readonly input: VerificationInput;
  readonly inputHash: string;
  readonly outputHash?: string;
  readonly status: "PASSED" | "FAILED" | "UNKNOWN";
  readonly violations: readonly string[];
  readonly metamorphicProofs: readonly MetamorphicProof[];
}

export interface BoundedVerificationReport {
  readonly id: string;
  readonly status: VerificationStatus;
  readonly totalCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly unknownCases: number;
  readonly metamorphicChecks: number;
  readonly searchComplete: boolean;
  readonly cases: readonly VerifiedCase[];
  readonly proofHash: string;
}

function casesFor(dimensions: readonly VerificationDimension[]): VerificationInput[] {
  let cases: Array<Record<string, VerificationValue>> = [{}];
  for (const dimension of dimensions) {
    cases = cases.flatMap((current) => dimension.values.map((value) => ({ ...current, [dimension.name]: structuredClone(value) })));
  }
  return cases;
}

export function verifyBoundedSpace<Output>(request: BoundedVerificationRequest<Output>): Readonly<BoundedVerificationReport> {
  if (!request.id.trim()) throw new Error("Verification id is required");
  if (!Number.isSafeInteger(request.maxCases) || request.maxCases < 1) throw new Error("maxCases must be a positive safe integer");
  if (request.dimensions.length === 0) throw new Error("At least one verification dimension is required");
  const names = new Set<string>();
  let declaredCases = 1;
  for (const dimension of request.dimensions) {
    if (!dimension.name.trim() || names.has(dimension.name)) throw new Error("Verification dimension names must be non-empty and unique");
    if (dimension.values.length === 0) throw new Error(`Verification dimension ${dimension.name} has no values`);
    names.add(dimension.name);
    declaredCases *= dimension.values.length;
    if (!Number.isSafeInteger(declaredCases)) throw new Error("Verification space exceeds the safe integer range");
  }
  const invariantIds = new Set<string>();
  for (const invariant of request.invariants) {
    if (!invariant.id.trim() || invariantIds.has(invariant.id)) throw new Error("Verification invariant ids must be non-empty and unique");
    invariantIds.add(invariant.id);
  }
  const transformationIds = new Set<string>();
  for (const transformation of request.transformations ?? []) {
    if (!transformation.id.trim() || transformationIds.has(transformation.id)) throw new Error("Verification transformation ids must be non-empty and unique");
    transformationIds.add(transformation.id);
  }
  if (declaredCases > request.maxCases) {
    const base = {
      id: request.id, status: "UNKNOWN" as const, totalCases: declaredCases, passedCases: 0, failedCases: 0,
      unknownCases: declaredCases, metamorphicChecks: 0, searchComplete: false, cases: [] as VerifiedCase[],
    };
    return deepFreeze({ ...base, proofHash: canonicalHash(base) });
  }
  const verifiedCases: VerifiedCase[] = casesFor(request.dimensions).map((input) => {
    const inputHash = canonicalHash(input);
    try {
      const output = request.execute(input);
      const invariantViolations = request.invariants.flatMap((invariant) => invariant.check(input, output).map((message) => `${invariant.id}: ${message}`));
      const metamorphicProofs: MetamorphicProof[] = (request.transformations ?? []).map((transformation) => {
        let transformedInput: VerificationInput;
        try {
          transformedInput = transformation.transform(structuredClone(input));
          const transformedOutput = request.execute(transformedInput);
          const violations = transformation.compare({ input, output, transformedInput, transformedOutput })
            .map((message) => `${transformation.id}: ${message}`);
          return {
            transformationId: transformation.id,
            transformedInputHash: canonicalHash(transformedInput),
            transformedOutputHash: canonicalHash(transformedOutput),
            status: violations.length === 0 ? "PASSED" as const : "FAILED" as const,
            violations,
          };
        } catch (error) {
          return {
            transformationId: transformation.id,
            transformedInputHash: canonicalHash({ transformationFailed: transformation.id, input }),
            status: "UNKNOWN" as const,
            violations: [error instanceof Error ? `${transformation.id}: ${error.message}` : `${transformation.id}: transformation failed`],
          };
        }
      });
      const violations = [...invariantViolations, ...metamorphicProofs.flatMap((proof) => proof.violations)];
      const status = invariantViolations.length > 0 || metamorphicProofs.some((proof) => proof.status === "FAILED")
        ? "FAILED" as const
        : metamorphicProofs.some((proof) => proof.status === "UNKNOWN") ? "UNKNOWN" as const : "PASSED" as const;
      return {
        input, inputHash, outputHash: canonicalHash(output), status, violations, metamorphicProofs,
      };
    } catch (error) {
      return {
        input, inputHash, status: "UNKNOWN" as const,
        violations: [error instanceof Error ? error.message : "Verification execution failed"], metamorphicProofs: [],
      };
    }
  });
  const passedCases = verifiedCases.filter(({ status }) => status === "PASSED").length;
  const failedCases = verifiedCases.filter(({ status }) => status === "FAILED").length;
  const unknownCases = verifiedCases.filter(({ status }) => status === "UNKNOWN").length;
  const metamorphicChecks = verifiedCases.reduce((sum, verificationCase) => sum + verificationCase.metamorphicProofs.length, 0);
  const status: VerificationStatus = failedCases > 0 ? "REJECTED" : unknownCases > 0 ? "UNKNOWN" : "CERTIFIED";
  const base = {
    id: request.id, status, totalCases: verifiedCases.length, passedCases, failedCases, unknownCases, metamorphicChecks,
    searchComplete: true, cases: verifiedCases,
  };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}
