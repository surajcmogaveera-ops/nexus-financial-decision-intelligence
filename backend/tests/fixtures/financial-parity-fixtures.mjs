export const BASIC_PROFILE = {
  monthlyIncome: "30000",
  monthlyExpenses: "20000",
  monthlyDebtPayments: "0",
  liquidSavings: "40000",
  essentialMonthlyExpenses: "20000",
  investments: "0",
  monthlyInvestmentContribution: "0",
  goals: [],
};

export const FLAGSHIP_BASELINE = {
  ...BASIC_PROFILE,
  goals: [
    {
      name: "Flagship goal",
      targetAmount: "200000",
      currentAllocatedAmount: "40000",
      monthsRemaining: 12,
      returnAssumption: 0,
      priority: 1,
    },
  ],
};

export const INVEST_5000_SCENARIO = {
  ...FLAGSHIP_BASELINE,
  monthlyInvestmentContribution: "5000",
};

export const EXPECTED = {
  basic: {
    monthlySurplus: "10000",
    savingsRate: 1 / 3,
    debtToIncome: 0,
    emergencyCoverageMonths: 2,
    currentFundingGap: "0",
  },
  flagshipBaseline: {
    monthlySurplus: "10000",
    availableMonthlyCashFlow: "10000",
    currentFundingGap: "160000",
    requiredMonthlyContribution: "13333.33333333333333333333333",
    projectedAmount: "160000",
    projectedGoalShortfall: "40000",
  },
  invest5000: {
    availableMonthlyCashFlow: "5000",
    projectedAmount: "100000",
    projectedGoalShortfall: "100000",
    additionalScenarioShortfall: "60000",
  },
};
