import { verifyCompiledHash } from "./compile.js";
import { validateSchema } from "./schema-validator.js";
import { typeCheck } from "./type-checker.js";
import type { TournamentSpec, ValidationFinding, ValidationResult } from "./types.js";

export function validateTournamentSpec(value: unknown): ValidationResult {
  const schemaFindings = validateSchema(value);
  if (schemaFindings.length > 0) return { valid: false, findings: schemaFindings };
  const spec = value as TournamentSpec;
  const findings: ValidationFinding[] = typeCheck(spec);
  if (!verifyCompiledHash(spec)) findings.push({
    code: "TSC630",
    severity: "ERROR",
    path: "/metadata/compiledSpecHash",
    message: "Compiled specification hash does not match its canonical semantic content.",
  });
  return { valid: !findings.some(({ severity }) => severity === "ERROR"), findings };
}
