import { getPrismaClient } from "../db/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";

export type StoredDecimal = string | number | { toString(): string };

export interface StoredGoal {
  id: string;
  financialProfileId: string;
  name: string;
  targetAmount: StoredDecimal;
  currentAllocatedAmount: StoredDecimal;
  targetDate: Date | string | null;
  monthsRemaining: number | null;
  monthlyContribution: StoredDecimal;
  fundingSource: string | null;
  returnAssumption: StoredDecimal | null;
  priority: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancialProfileRecord {
  id: string;
  userId: string;
  currency: string;
  monthlyIncome: StoredDecimal | null;
  monthlyExpenses: StoredDecimal | null;
  monthlyDebtPayments: StoredDecimal | null;
  liquidSavings: StoredDecimal | null;
  investments: StoredDecimal | null;
  monthlyInvestmentContribution: StoredDecimal | null;
  essentialMonthlyExpenses: StoredDecimal | null;
  incomeSources: Array<{ name: string; amount: StoredDecimal; frequency: string; isActive: boolean }>;
  expenseCategories: Array<{ name: string; amount: StoredDecimal; frequency: string; isEssential: boolean; isActive: boolean }>;
  debts: Array<{ name: string; monthlyPayment: StoredDecimal; paymentFrequency: string; isActive: boolean }>;
  assets: Array<{ name: string; currentValue: StoredDecimal; isLiquid: boolean }>;
  investmentsList: Array<{ name: string; currentValue: StoredDecimal; monthlyContribution: StoredDecimal | null }>;
  goals: StoredGoal[];
}

export interface GoalWriteData {
  name: string;
  targetAmount: string;
  currentAllocatedAmount: string;
  targetDate: Date | null;
  monthsRemaining: number | null;
  monthlyContribution: string;
  fundingSource: string | null;
  returnAssumption: number;
  priority: number;
  status: string;
}

export interface FinancialDataRepository {
  findProfileByUserId(userId: string): Promise<FinancialProfileRecord | null>;
  listGoals(financialProfileId: string): Promise<StoredGoal[]>;
  createGoal(financialProfileId: string, data: GoalWriteData): Promise<StoredGoal>;
  findGoalForProfile(id: string, financialProfileId: string): Promise<StoredGoal | null>;
  updateGoalForProfile(id: string, financialProfileId: string, data: GoalWriteData): Promise<StoredGoal | null>;
}

export class PrismaFinancialDataRepository implements FinancialDataRepository {
  constructor(private readonly clientProvider: () => PrismaClient = getPrismaClient) {}

  async findProfileByUserId(userId: string): Promise<FinancialProfileRecord | null> {
    const row = await this.clientProvider().financialProfile.findUnique({
      where: { userId },
      include: {
        incomeSources: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        expenseCategories: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        debts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        assets: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        investmentsList: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        goals: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    return row as unknown as FinancialProfileRecord | null;
  }

  async listGoals(financialProfileId: string): Promise<StoredGoal[]> {
    const rows = await this.clientProvider().goal.findMany({
      where: { financialProfileId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows as unknown as StoredGoal[];
  }

  async createGoal(financialProfileId: string, data: GoalWriteData): Promise<StoredGoal> {
    const row = await this.clientProvider().goal.create({ data: { ...data, financialProfileId } });
    return row as unknown as StoredGoal;
  }

  async findGoalForProfile(id: string, financialProfileId: string): Promise<StoredGoal | null> {
    const row = await this.clientProvider().goal.findFirst({ where: { id, financialProfileId } });
    return row as unknown as StoredGoal | null;
  }

  async updateGoalForProfile(id: string, financialProfileId: string, data: GoalWriteData): Promise<StoredGoal | null> {
    const result = await this.clientProvider().goal.updateMany({
      where: { id, financialProfileId },
      data,
    });
    if (result.count === 0) return null;
    return this.findGoalForProfile(id, financialProfileId);
  }
}
