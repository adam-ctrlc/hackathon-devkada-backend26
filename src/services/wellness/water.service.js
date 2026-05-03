import { prisma } from "../../lib/prisma.js";
import { startOfDay, endOfDay } from "../../utils/date.js";

const toDateKey = (value) => new Date(value).toISOString().slice(0, 10);

export const sumWaterLogs = (logs = []) =>
  logs.reduce((sum, item) => sum + (Number(item.amountMl) || 0), 0);

export const getWaterIntakeRange = async ({ profileId, days = 7 }) => {
  const limitDays = Math.max(1, Math.min(90, Number(days) || 7));
  const since = new Date();
  since.setDate(since.getDate() - (limitDays - 1));
  const logs = await prisma.waterLog.findMany({
    where: {
      profileId,
      createdAt: { gte: startOfDay(since), lte: endOfDay(new Date()) },
    },
    orderBy: { createdAt: "desc" },
  });

  const byDate = new Map();
  for (const log of logs) {
    const key = toDateKey(log.createdAt);
    byDate.set(key, (byDate.get(key) ?? 0) + (Number(log.amountMl) || 0));
  }

  const series = [];
  for (let offset = limitDays - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = toDateKey(date);
    series.push({ date: key, amountMl: byDate.get(key) ?? 0 });
  }

  return {
    days: limitDays,
    totalMl: sumWaterLogs(logs),
    series,
    logs,
  };
};

export const buildWaterStreaks = ({ waterSeries = [], targetMl = 1500 }) => {
  let currentStreak = 0;
  let longestStreak = 0;

  for (let index = waterSeries.length - 1; index >= 0; index -= 1) {
    const item = waterSeries[index];
    if ((Number(item.amountMl) || 0) >= targetMl) {
      currentStreak += 1;
    } else {
      break;
    }
  }

  let run = 0;
  for (const item of waterSeries) {
    if ((Number(item.amountMl) || 0) >= targetMl) {
      run += 1;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 0;
    }
  }

  return {
    targetMl,
    currentStreak,
    longestStreak,
    progress: waterSeries.length
      ? Math.round(
          (waterSeries[waterSeries.length - 1].amountMl / targetMl) * 100,
        )
      : 0,
  };
};

export const recordWaterLog = async ({
  profileId,
  amountMl,
  source = "manual",
  note = null,
  createdAt = new Date(),
}) =>
  prisma.waterLog.create({
    data: {
      profileId,
      amountMl: Number(amountMl),
      source,
      note,
      createdAt,
    },
  });
