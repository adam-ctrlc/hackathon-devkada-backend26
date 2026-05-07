import "dotenv/config";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import prismaClientPkg from "@prisma/client";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const { PrismaClient } = prismaClientPkg;

const globalForPrisma = globalThis;

const createPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export let dbConnected = false;
let shutdownHandlersRegistered = false;

const registerShutdownHandlers = () => {
  if (shutdownHandlersRegistered) return;
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
    const url = process.env.DATABASE_URL ?? "";
    console.log(
      `Database connected: ${url.split("@").pop()?.split("?")[0] ?? "neon"}`,
    );
  } catch (error) {
    dbConnected = false;
    console.error(`Failed to connect to database: ${error.message}`);
    throw error;
  }
};
