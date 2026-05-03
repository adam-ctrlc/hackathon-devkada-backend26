import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import prismaClientPkg from "@prisma/client";

const { PrismaClient } = prismaClientPkg;

const globalForPrisma = globalThis;

const databaseUrl =
  process.env.DATABASE_URL ?? "file:./prisma/dev.db";

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

export const prisma =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export let dbConnected = false;
let shutdownHandlersRegistered = false;

const registerShutdownHandlers = () => {
  if (shutdownHandlersRegistered) {
    return;
  }

  shutdownHandlersRegistered = true;

  const shutdown = async () => {
    await prisma.$disconnect();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

export const connectDatabase = async () => {
  registerShutdownHandlers();

  try {
    await prisma.$connect();
    dbConnected = true;
    console.log(`Database connected: ${databaseUrl}`);
  } catch (error) {
    dbConnected = false;
    console.error(
      `Failed to connect to database at ${databaseUrl}: ${error.message}`,
    );
    throw error;
  }
};
