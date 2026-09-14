import type { StagePrimitive } from "@tournament-os/tournament-schema";

export interface SportAdapterRegistration { id: string; version: string; participantUnits: string[]; scoringCapabilities: string[]; resourceTypes: string[]; }
export interface FormatPackageRegistration { id: string; version: string; primitives: StagePrimitive[]; dynamic: boolean; }

export class ExtensionRegistry {
  readonly #sports = new Map<string, SportAdapterRegistration>();
  readonly #formats = new Map<string, FormatPackageRegistration>();
  registerSport(adapter: SportAdapterRegistration): void { this.#register(this.#sports, adapter); }
  registerFormat(format: FormatPackageRegistration): void { this.#register(this.#formats, format); }
  sport(id: string, version: string): SportAdapterRegistration { return this.#get(this.#sports, id, version); }
  format(id: string, version: string): FormatPackageRegistration { return this.#get(this.#formats, id, version); }
  private key(id: string, version: string) { return `${id}@${version}`; }
  #register<T extends { id: string; version: string }>(map: Map<string, T>, value: T) {
    const key = this.key(value.id, value.version); if (map.has(key)) throw new Error(`Extension already registered: ${key}`);
    map.set(key, Object.freeze(structuredClone(value)));
  }
  #get<T>(map: Map<string, T>, id: string, version: string): T {
    const value = map.get(this.key(id, version)); if (!value) throw new Error(`Unregistered extension: ${this.key(id, version)}`); return value;
  }
}

export const builtInRegistry = new ExtensionRegistry();
builtInRegistry.registerSport({ id: "padel", version: "1.0.0", participantUnits: ["pair"], scoringCapabilities: ["games", "sets", "timed_matches", "golden_point", "tie_break"], resourceTypes: ["court"] });
builtInRegistry.registerFormat({ id: "static-dag", version: "1.0.0", primitives: ["groups", "single_round_robin", "double_round_robin", "single_elimination", "consolation", "placement", "play_in", "repechage", "custom_graph"], dynamic: false });
builtInRegistry.registerFormat({ id: "americano", version: "1.0.0", primitives: ["ranking_stage"], dynamic: true });
