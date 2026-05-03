const toDateKey = (value) => new Date(value).toISOString().slice(0, 10);

const getSupportColor = (level) => {
  switch (level) {
    case "Low":
      return "#3b82f6";
    case "Medium":
      return "#eab308";
    case "High":
      return "#ef4444";
    default:
      return "#9ca3af";
  }
};

export const buildCalendarView = ({ summaries = [], days = 30 }) => {
  const byDate = new Map(summaries.map((item) => [toDateKey(item.date), item]));
  const series = [];
  const today = new Date();
  const counts = { Low: 0, Medium: 0, High: 0, "No Data": 0 };

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = toDateKey(date);
    const summary = byDate.get(key);

    const item = summary
      ? {
          date: key,
          score: summary.score,
          supportLevel: summary.supportLevel,
          color: getSupportColor(summary.supportLevel),
          highlights: summary.highlights,
          suggestions: summary.suggestions,
        }
      : {
          date: key,
          score: null,
          supportLevel: "No Data",
          color: getSupportColor("No Data"),
          highlights: [],
          suggestions: [],
        };

    counts[item.supportLevel] = (counts[item.supportLevel] ?? 0) + 1;
    series.push(item);
  }

  const compact = series.filter((item) => item.supportLevel !== "No Data");
  let currentLevel = null;
  let currentStreak = 0;
  let longestLow = 0;
  let longestHigh = 0;
  let runLevel = null;
  let runLength = 0;

  for (const item of compact) {
    if (item.supportLevel === runLevel) {
      runLength += 1;
    } else {
      runLevel = item.supportLevel;
      runLength = 1;
    }

    if (item.supportLevel === "Low") {
      longestLow = Math.max(longestLow, runLength);
    }

    if (item.supportLevel === "High") {
      longestHigh = Math.max(longestHigh, runLength);
    }
  }

  for (let index = series.length - 1; index >= 0; index -= 1) {
    const item = series[index];
    if (item.supportLevel === "No Data") {
      continue;
    }

    if (!currentLevel) {
      currentLevel = item.supportLevel;
      currentStreak = 1;
      continue;
    }

    if (item.supportLevel === currentLevel) {
      currentStreak += 1;
    } else {
      break;
    }
  }

  let notice =
    "Keep logging food and diary entries to reveal your wellness pattern.";
  if (currentStreak >= 3) {
    switch (currentLevel) {
      case "Low":
        notice = `You have been in Low Wellness Support for ${currentStreak} recorded days in a row.`;
        break;
      case "High":
        notice = `You have been in High Wellness Support for ${currentStreak} recorded days in a row.`;
        break;
      case "Medium":
        notice = `You have been in Medium Wellness Support for ${currentStreak} recorded days in a row.`;
        break;
      default:
        break;
    }
  }

  const dominantLevel = ["Low", "Medium", "High"].reduce(
    (best, level) => (counts[level] > counts[best] ? level : best),
    "No Data",
  );

  return {
    calendar: series,
    legend: {
      Low: getSupportColor("Low"),
      Medium: getSupportColor("Medium"),
      High: getSupportColor("High"),
      "No Data": getSupportColor("No Data"),
    },
    counts,
    streaks: {
      currentLevel,
      currentStreak,
      longestLow,
      longestHigh,
      dominantLevel,
      dominantColor: getSupportColor(dominantLevel),
      notice,
    },
  };
};
