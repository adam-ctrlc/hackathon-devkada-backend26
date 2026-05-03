const normalizeFrequency = (value) => {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) {
    return null;
  }

  if (text.startsWith("day")) return "daily";
  if (text.startsWith("week")) return "weekly";
  if (text.startsWith("month")) return "monthly";
  if (text.startsWith("year")) return "yearly";
  return text;
};

const frequencyToDays = (frequency) => {
  switch (normalizeFrequency(frequency)) {
    case "daily":
      return 1;
    case "weekly":
      return 7;
    case "monthly":
      return 30;
    case "yearly":
      return 365;
    default:
      return null;
  }
};

const roundMoney = (value) =>
  Number.isFinite(value) ? Number(value.toFixed(2)) : null;

const normalizeCurrency = (value) => {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  return text.length === 3 ? text : null;
};

const toAmount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const buildBudgetContext = ({
  profile = {},
  amountSpent = 0,
  fallbackDailyBudget = 100,
  fallbackCurrency = "PHP",
} = {}) => {
  const budgetAmount = toAmount(profile.budgetAmount);
  const budgetFrequency = normalizeFrequency(profile.budgetFrequency);
  const incomeAmount = toAmount(profile.incomeAmount);
  const incomeFrequency = normalizeFrequency(profile.incomeFrequency);
  const budgetCurrency = normalizeCurrency(profile.budgetCurrency);
  const incomeCurrency = normalizeCurrency(profile.incomeCurrency);
  const currency =
    budgetCurrency ??
    incomeCurrency ??
    normalizeCurrency(fallbackCurrency) ??
    "PHP";

  let source = "default";
  let baseAmount = budgetAmount;
  let baseFrequency = budgetFrequency;

  if (baseAmount != null && !baseFrequency) {
    baseFrequency = "monthly";
  }

  if (baseAmount == null && incomeAmount != null) {
    source = "income";
    baseAmount = incomeAmount * 0.15;
    baseFrequency = incomeFrequency ?? "monthly";
  }

  if (baseAmount == null) {
    source = "fallback";
    baseAmount = fallbackDailyBudget;
    baseFrequency = "daily";
  }

  const days = frequencyToDays(baseFrequency) ?? 1;
  const dailyBudget = baseAmount / days;
  const weeklyBudget = dailyBudget * 7;
  const monthlyBudget = dailyBudget * 30;
  const remainingToday = dailyBudget - amountSpent;

  return {
    source,
    currency,
    budgetAmount: roundMoney(baseAmount),
    budgetFrequency: baseFrequency,
    incomeAmount: roundMoney(incomeAmount),
    incomeFrequency,
    budgetCurrency,
    incomeCurrency,
    dailyBudget: roundMoney(dailyBudget),
    weeklyBudget: roundMoney(weeklyBudget),
    monthlyBudget: roundMoney(monthlyBudget),
    amountSpent: roundMoney(amountSpent),
    remainingToday: roundMoney(remainingToday),
    overBudget: amountSpent > dailyBudget,
    daysPerBudget: days,
  };
};

export const sumEstimatedSpend = ({ logs = [], currency = null } = {}) =>
  logs.reduce((sum, item) => {
    const itemCurrency = normalizeCurrency(
      item.estimatedPriceCurrency ??
        item?.aiAnalysis?.budgetContext?.currency ??
        item?.aiAnalysis?.budgetCurrency,
    );
    if (
      currency &&
      itemCurrency &&
      itemCurrency !== normalizeCurrency(currency)
    ) {
      return sum;
    }

    return (
      sum +
      (Number(item.estimatedPricePhp ?? item?.aiAnalysis?.budgetEstimatePhp) ||
        0)
    );
  }, 0);
