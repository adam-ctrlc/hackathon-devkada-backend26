import "dotenv/config";
import bcrypt from "bcryptjs";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import prismaClientPkg from "@prisma/client";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const { PrismaClient } = prismaClientPkg;

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const hashPassword = async (password) => bcrypt.hash(password, 10);

const clearDatabase = async () => {
  await prisma.accountInvite.deleteMany();
  await prisma.dailySummary.deleteMany();
  await prisma.diaryChunk.deleteMany();
  await prisma.diaryEntry.deleteMany();
  await prisma.wellnessTask.deleteMany();
  await prisma.waterLog.deleteMany();
  await prisma.workoutLog.deleteMany();
  await prisma.mealLog.deleteMany();
  await prisma.foodScan.deleteMany();
  await prisma.healthContext.deleteMany();
  await prisma.profile.deleteMany();
};

const main = async () => {
  await clearDatabase();

  const parentPassword = await hashPassword("password123");
  const childPassword = await hashPassword("password123");
  const individualPassword = await hashPassword("password123");

  const parent = await prisma.profile.create({
    data: {
      email: "parent@example.com",
      username: "mara.santos",
      passwordHash: parentPassword,
      firstName: "Mara",
      middleName: "Lopez",
      lastName: "Santos",
      role: "PARENT",
      age: 36,
      sex: "FEMALE",
      heightCm: 160,
      weightKg: 61.5,
      activityLevel: "moderate",
      healthGoal: "Maintain energy and manage family meals",
      incomeAmount: 42000,
      incomeFrequency: "monthly",
      incomeCurrency: "PHP",
      budgetAmount: 12000,
      budgetFrequency: "monthly",
      budgetCurrency: "PHP",
      allergies: ["shrimp"],
      foodPreferences: ["home-cooked", "vegetables", "fish"],
      dietRestrictions: ["low sodium"],
      healthContext: {
        create: {
          status: "pregnant",
          notes: "Track balanced nutrition and hydration carefully.",
          customRestriction: "Avoid risky foods during pregnancy.",
        },
      },
    },
  });

  const child = await prisma.profile.create({
    data: {
      email: "child@example.com",
      username: "kai.santos",
      passwordHash: childPassword,
      firstName: "Kai",
      lastName: "Santos",
      role: "CHILD",
      parentProfileId: parent.id,
      age: 12,
      sex: "MALE",
      heightCm: 145,
      weightKg: 38.2,
      activityLevel: "active",
      healthGoal: "Support growth and school energy",
      incomeAmount: null,
      incomeFrequency: null,
      incomeCurrency: null,
      budgetAmount: null,
      budgetFrequency: null,
      budgetCurrency: null,
      allergies: [],
      foodPreferences: ["rice", "fruit", "chicken"],
      dietRestrictions: ["no spicy food"],
      healthContext: {
        create: {
          status: "recovering from surgery",
          notes: "Keep meals soft and easy to digest.",
          customRestriction: "Soft food only for now.",
        },
      },
    },
  });

  const individual = await prisma.profile.create({
    data: {
      email: "individual@example.com",
      username: "jules.reyes",
      passwordHash: individualPassword,
      firstName: "Jules",
      lastName: "Reyes",
      role: "INDIVIDUAL",
      age: 28,
      sex: "FEMALE",
      heightCm: 168,
      weightKg: 62,
      activityLevel: "light",
      healthGoal: "Improve energy and reduce sugar",
      incomeAmount: 38000,
      incomeFrequency: "monthly",
      incomeCurrency: "PHP",
      budgetAmount: 9000,
      budgetFrequency: "monthly",
      budgetCurrency: "PHP",
      allergies: ["nuts"],
      foodPreferences: ["salads", "eggs", "oats"],
      dietRestrictions: ["low sugar"],
      healthContext: {
        create: {
          status: "illness recovery",
          notes: "Prefer light meals and hydration.",
          customRestriction: "Keep meals gentle for recovery.",
        },
      },
    },
  });

  await prisma.accountInvite.create({
    data: {
      code: "INVITE-PARENT-001",
      inviterProfileId: parent.id,
      invitedRole: "CHILD",
      status: "PENDING",
      note: "Join the family wellness space.",
    },
  });

  const parentScan = await prisma.foodScan.create({
    data: {
      profileId: parent.id,
      productName: "Grilled tilapia with vegetables",
      foodType: "main meal",
      calories: 420,
      sugarGrams: 4.2,
      sodiumMg: 280,
      fatGrams: 12,
      proteinGrams: 34,
      fiberGrams: 8,
      score: 88,
      supportLevel: "High",
      wellnessImpact: "Supports pregnancy nutrition well.",
      betterAlternatives: ["Water", "Fruit"],
      notes: ["Balanced protein", "Good fiber"],
      aiAnalysis: {
        source: "seed",
        patternSummary: "Balanced family meal pattern",
      },
    },
  });

  const parentDiary = await prisma.diaryEntry.create({
    data: {
      profileId: parent.id,
      moodTag: "calm",
      energyLevel: 4,
      stressLevel: 2,
      sleepHours: 7.5,
      waterIntakeMl: 2100,
      activityMinutes: 35,
      weightKg: 61.2,
      symptoms: ["none"],
      entry: "Felt steady today. Ate well and kept water nearby.",
      aiReflection:
        "Good hydration and balanced meals are showing up in the pattern.",
    },
  });

  await prisma.diaryChunk.createMany({
    data: [
      {
        profileId: parent.id,
        diaryEntryId: parentDiary.id,
        chunkIndex: 0,
        chunkText: "Felt steady today.",
        embedding: null,
        source: "journal",
      },
      {
        profileId: parent.id,
        diaryEntryId: parentDiary.id,
        chunkIndex: 1,
        chunkText: "Ate well and kept water nearby.",
        embedding: null,
        source: "journal",
      },
    ],
  });

  await prisma.dailySummary.create({
    data: {
      profileId: parent.id,
      date: new Date(),
      score: 84,
      supportLevel: "High",
      highlights: ["Balanced meals", "Good hydration", "Stable mood"],
      suggestions: ["Keep protein steady", "Continue hydration"],
      aiSummary: { source: "seed", headline: "Strong pregnancy support day" },
    },
  });

  await prisma.waterLog.create({
    data: {
      profileId: parent.id,
      amountMl: 750,
      source: "seed",
      note: "Morning water",
    },
  });

  await prisma.wellnessTask.create({
    data: {
      profileId: parent.id,
      title: "Keep hydration steady",
      reason: "Pregnancy support works better with regular fluids.",
      action: "Drink water throughout the day.",
      category: "hydration",
      priority: "High",
      status: "suggested",
      source: "ai",
      aiPayload: { source: "seed" },
    },
  });

  await prisma.foodScan.create({
    data: {
      profileId: child.id,
      productName: "Soft chicken porridge",
      foodType: "soft meal",
      calories: 310,
      sugarGrams: 2.1,
      sodiumMg: 210,
      fatGrams: 6,
      proteinGrams: 19,
      fiberGrams: 3,
      score: 91,
      supportLevel: "High",
      wellnessImpact: "Great recovery meal.",
      betterAlternatives: ["Water", "Banana"],
      notes: ["Soft texture", "High protein"],
      aiAnalysis: {
        source: "seed",
        patternSummary: "Recovery-friendly meal pattern",
      },
    },
  });

  await prisma.mealLog.create({
    data: {
      profileId: individual.id,
      rawText: "Greek yogurt with oats and berries",
      matchedProductName: "Greek yogurt bowl",
      foodType: "breakfast",
      source: "seed",
      estimatedPricePhp: 120,
      estimatedPriceCurrency: "PHP",
      calories: 340,
      sugarGrams: 9,
      sodiumMg: 110,
      fatGrams: 8,
      proteinGrams: 22,
      fiberGrams: 6,
      score: 86,
      supportLevel: "High",
      wellnessImpact: "Good energy support.",
      betterAlternatives: ["Water", "Boiled egg"],
      notes: ["Protein-rich", "Low sugar"],
      aiAnalysis: {
        source: "seed",
        patternSummary: "Energy-focused breakfast pattern",
      },
    },
  });

  await prisma.workoutLog.create({
    data: {
      profileId: individual.id,
      title: "Evening walk",
      workoutType: "walk",
      source: "seed",
      durationMinutes: 35,
      durationHours: 0.58,
      caloriesBurned: 180,
      distanceKm: 3.2,
      intensity: "light",
      notes: ["seed"],
      aiAnalysis: {
        source: "seed",
        summary: "Light activity supports energy.",
      },
    },
  });

  await prisma.wellnessTask.create({
    data: {
      profileId: individual.id,
      title: "Reduce hidden sugar",
      reason: "Energy drops can come from sugary drinks.",
      action: "Swap one sweet drink for water or unsweetened tea.",
      category: "food",
      priority: "Medium",
      status: "suggested",
      source: "ai",
      aiPayload: { source: "seed" },
    },
  });

  await prisma.accountInvite.create({
    data: {
      code: "INVITE-INDIVIDUAL-001",
      inviterProfileId: individual.id,
      invitedRole: "PARENT",
      status: "ACCEPTED",
      note: "Connected for shared wellness tracking.",
      acceptedAt: new Date(),
      inviteeProfileId: parent.id,
    },
  });

  console.log("Seed complete:", {
    parent: parent.email,
    child: child.email,
    individual: individual.email,
  });
};

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
