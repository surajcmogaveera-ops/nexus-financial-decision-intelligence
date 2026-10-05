const NOW = new Date("2026-10-05T00:00:00.000Z");

export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const USER_WITHOUT_PROFILE = "33333333-3333-4333-8333-333333333333";
export const PROFILE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PROFILE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const GOAL_A = "aaaaaaaa-0000-4000-8000-000000000001";
export const GOAL_B = "bbbbbbbb-0000-4000-8000-000000000002";

export function makeGoal({
  id = GOAL_A,
  financialProfileId = PROFILE_A,
  name = "Emergency fund",
  targetAmount = "200000",
  currentAllocatedAmount = "40000",
  targetDate = null,
  monthsRemaining = 12,
  monthlyContribution = "5000",
  fundingSource = null,
  returnAssumption = "0",
  priority = 1,
  status = "active",
  createdAt = NOW,
  updatedAt = NOW,
} = {}) {
  return { id, financialProfileId, name, targetAmount, currentAllocatedAmount,
    targetDate, monthsRemaining, monthlyContribution, fundingSource,
    returnAssumption, priority, status, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) };
}

export function makeProfile({
  id = PROFILE_A,
  userId = USER_A,
  monthlyIncome = null,
  monthlyExpenses = null,
  monthlyDebtPayments = null,
  liquidSavings = null,
  investments = null,
  monthlyInvestmentContribution = null,
  essentialMonthlyExpenses = null,
  incomeSources = [{ name: "Salary", amount: "30000", frequency: "monthly", isActive: true }],
  expenseCategories = [{ name: "Living expenses", amount: "20000", frequency: "monthly", isEssential: true, isActive: true }],
  debts = [],
  assets = [{ name: "Cash savings", currentValue: "40000", isLiquid: true }],
  investmentsList = [],
  goals = [],
} = {}) {
  return { id, userId, currency: "INR", monthlyIncome, monthlyExpenses,
    monthlyDebtPayments, liquidSavings, investments, monthlyInvestmentContribution,
    essentialMonthlyExpenses, incomeSources, expenseCategories, debts, assets,
    investmentsList, goals };
}

export class InMemoryFinancialDataRepository {
  constructor(profiles = []) {
    this.profiles = new Map(profiles.map((profile) => [profile.userId, structuredClone(profile)]));
    this.nextId = 10;
  }

  async findProfileByUserId(userId) {
    const profile = this.profiles.get(userId);
    return profile ? structuredClone(profile) : null;
  }

  async listGoals(financialProfileId) {
    const profile = [...this.profiles.values()].find((item) => item.id === financialProfileId);
    return profile ? structuredClone(profile.goals) : [];
  }

  async createGoal(financialProfileId, data) {
    const profile = [...this.profiles.values()].find((item) => item.id === financialProfileId);
    if (!profile) throw new Error("test fixture profile not found");
    const suffix = String(this.nextId++).padStart(12, "0");
    const record = makeGoal({ ...data, id: `00000000-0000-4000-8000-${suffix}`, financialProfileId, createdAt: new Date(), updatedAt: new Date() });
    profile.goals.push(record);
    return structuredClone(record);
  }

  async findGoalForProfile(id, financialProfileId) {
    const profile = [...this.profiles.values()].find((item) => item.id === financialProfileId);
    const goal = profile?.goals.find((item) => item.id === id);
    return goal ? structuredClone(goal) : null;
  }

  async updateGoalForProfile(id, financialProfileId, data) {
    const profile = [...this.profiles.values()].find((item) => item.id === financialProfileId);
    const index = profile?.goals.findIndex((item) => item.id === id) ?? -1;
    if (!profile || index < 0) return null;
    profile.goals[index] = { ...profile.goals[index], ...structuredClone(data), updatedAt: new Date() };
    return structuredClone(profile.goals[index]);
  }

  clear() {
    this.profiles.clear();
  }
}

export function testUserContext(request) {
  const userId = request.get("x-test-user");
  return userId ? { userId } : null;
}
