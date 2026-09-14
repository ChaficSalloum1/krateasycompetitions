import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import schema from "../schema/tournament-spec.schema.json" with { type: "json" };
import type { TournamentSpec, ValidationFinding } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validate = ajv.compile<TournamentSpec>(schema);

function toFinding(error: ErrorObject): ValidationFinding {
  return {
    code: "TSC000",
    severity: "ERROR",
    path: error.instancePath || "/",
    message: `${error.message ?? "schema validation failed"}`,
    evidence: { keyword: error.keyword, params: error.params },
  };
}

export function validateSchema(value: unknown): ValidationFinding[] {
  return validate(value) ? [] : (validate.errors ?? []).map(toFinding);
}
