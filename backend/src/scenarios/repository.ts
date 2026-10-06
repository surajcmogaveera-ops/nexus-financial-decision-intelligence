import { getPrismaClient } from "../db/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { SimulationResponse } from "../simulations/types.js";

export interface ScenarioEvidenceRepository {
  createForUser(userId: string, result: SimulationResponse, scenarioInput?: unknown): Promise<string | null>;
  findOwnedResult(userId: string, scenarioId: string): Promise<unknown | null>;
}

/** Persists and reads evidence through the existing Scenario and ScenarioResult models. */
export class PrismaScenarioEvidenceRepository implements ScenarioEvidenceRepository {
  constructor(private readonly clientProvider: () => PrismaClient = getPrismaClient) {}

  async createForUser(userId: string, result: SimulationResponse, scenarioInput: unknown = { type: result.scenario.type }): Promise<string | null> {
    const client = this.clientProvider();
    const profile = await client.financialProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) return null;
    // H15 places the same evidence collection on both API states; persist it once under scenario.
    const persistedResult = { ...result, baseline: { ...result.baseline, evidence: [] } };
    const row = await client.scenario.create({
      data: {
        financialProfileId: profile.id,
        name: `${result.scenario.type} simulation`,
        scenarioType: result.scenario.type,
        inputChanges: JSON.parse(JSON.stringify(scenarioInput)),
        results: { create: { resultData: JSON.parse(JSON.stringify(persistedResult)) } },
      },
      select: { id: true },
    });
    return row.id;
  }

  async findOwnedResult(userId: string, scenarioId: string): Promise<unknown | null> {
    const row = await this.clientProvider().scenario.findFirst({
      where: { id: scenarioId, financialProfile: { userId } },
      select: { id: true, results: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { resultData: true } } },
    });
    return row?.results[0]?.resultData ?? null;
  }
}
