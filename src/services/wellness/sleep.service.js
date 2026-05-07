import { prisma } from "../../lib/prisma.js";
import { endOfDay, startOfDay } from "../../utils/date.js";

const toDateKey = (value) => new Date(value).toISOString().slice(0, 10);

export const sumSleepHours = (logs = []) =>
  logs.reduce((sum, item) => sum + (Number(item.hours) || 0), 0);

export const getSleepRange = async ({ profileId, days = 7 }) => {
  const limitDays = Math.max(1, Math.min(90, Number(days) || 7));
  const since = new Date();
  since.setDate(since.getDate() - (limitDays - 1));
  const start = startOfDay(since);
  const end = endOfDay(new Date());

  const logs = await prisma.sleepLog.findMany({
    where: {
      profileId,
      OR: [
        { sleptAt: { gte: start, lte: end } },
        { sleptAt: null, createdAt: { gte: start, lte: end } },
      ],
    },
    orderBy: [{ sleptAt: "desc" }, { createdAt: "desc" }],
  });

  const byDate = new Map();
  for (const log of logs) {
    const key = toDateKey(log.sleptAt ?? log.createdAt);
    byDate.set(key, (byDate.get(key) ?? 0) + (Number(log.hours) || 0));
  }

  const series = [];
  for (let offset = limitDays - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = toDateKey(date);
    series.push({ date: key, hours: byDate.get(key) ?? 0 });
  }

  return {
    days: limitDays,
    totalHours: sumSleepHours(logs),
    series,
    logs,
  };
};

export const recordSleepLog = async ({
  profileId,
  hours,
  sleepPeriod = null,
  source = "manual",
  note = null,
  sleptAt = null,
  createdAt = new Date(),
}) =>
  prisma.sleepLog.create({
    data: {
      profileId,
      hours: Number(hours),
      sleepPeriod,
      sleptAt,
      source,
      note,
      createdAt,
    },
  });
