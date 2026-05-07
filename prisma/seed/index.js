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

  // ── DEMO / JUDGE ACCOUNT ────────────────────────────────────────────────────
  const judgePassword = await hashPassword("KainWise2026!");

  const judge = await prisma.profile.create({
    data: {
      email: "judge@kainwise.demo",
      username: "judge.kainwise",
      passwordHash: judgePassword,
      emailVerified: true,
      firstName: "Alex",
      lastName: "Judge",
      role: "INDIVIDUAL",
      age: 30,
      sex: "MALE",
      heightCm: 172,
      weightKg: 70,
      activityLevel: "active",
      healthGoal: "Eat healthier",
      budgetAmount: 8000,
      budgetFrequency: "monthly",
      budgetCurrency: "PHP",
      allergies: [],
      foodPreferences: ["Filipino food", "rice", "vegetables"],
      dietRestrictions: ["low sodium"],
      healthContext: {
        create: {
          status: "Managing hypertension",
          notes: "Monitoring sodium and fat intake daily.",
          customRestriction: "Avoid high-sodium processed foods.",
        },
      },
    },
  });

  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(12, 0, 0, 0);
    return d;
  };

  // Food scans — spread over past 14 days
  const scanData = [
    {
      productName: "Chicken Adobo with White Rice",
      foodType: "main meal",
      calories: 520,
      sugarGrams: 3.1,
      sodiumMg: 640,
      fatGrams: 16,
      proteinGrams: 38,
      fiberGrams: 2,
      score: 72,
      supportLevel: "High",
      wellnessImpact:
        "Good protein source but watch the sodium from soy sauce.",
      betterAlternatives: [
        "Grilled chicken breast",
        "Steamed fish with vegetables",
      ],
      notes: ["High protein", "Elevated sodium"],
      estimatedPricePhp: 95,
      daysBack: 0,
    },
    {
      productName: "Sinigang na Baboy",
      foodType: "main meal",
      calories: 380,
      sugarGrams: 2.4,
      sodiumMg: 820,
      fatGrams: 14,
      proteinGrams: 26,
      fiberGrams: 5,
      score: 65,
      supportLevel: "Medium",
      wellnessImpact:
        "Rich in vegetables but high sodium from soup base — limit broth.",
      betterAlternatives: ["Sinigang na Isda", "Tinolang Manok"],
      notes: ["Good vegetables", "High sodium from tamarind base"],
      estimatedPricePhp: 110,
      daysBack: 1,
    },
    {
      productName: "Banana (Lakatan)",
      foodType: "snack",
      calories: 105,
      sugarGrams: 14.4,
      sodiumMg: 1,
      fatGrams: 0.4,
      proteinGrams: 1.3,
      fiberGrams: 3.1,
      score: 91,
      supportLevel: "High",
      wellnessImpact:
        "Excellent potassium source that helps counter sodium intake.",
      betterAlternatives: [],
      notes: ["High potassium", "Natural energy boost"],
      estimatedPricePhp: 12,
      daysBack: 1,
    },
    {
      productName: "Cup Noodles (Chicken Flavor)",
      foodType: "snack",
      calories: 290,
      sugarGrams: 2.0,
      sodiumMg: 1760,
      fatGrams: 11,
      proteinGrams: 7,
      fiberGrams: 1,
      score: 24,
      supportLevel: "Low",
      wellnessImpact:
        "Very high sodium — a single serving exceeds daily recommended limit for hypertension management.",
      betterAlternatives: [
        "Arroz caldo",
        "Lugaw with boiled egg",
        "Tinolang Manok",
      ],
      notes: ["Extremely high sodium", "Low protein", "Highly processed"],
      estimatedPricePhp: 35,
      daysBack: 2,
    },
    {
      productName: "Tinolang Manok",
      foodType: "main meal",
      calories: 310,
      sugarGrams: 1.8,
      sodiumMg: 310,
      fatGrams: 8,
      proteinGrams: 30,
      fiberGrams: 4,
      score: 88,
      supportLevel: "High",
      wellnessImpact:
        "Excellent choice — lean protein, ginger aids digestion, low sodium.",
      betterAlternatives: [],
      notes: [
        "Heart-healthy",
        "Low sodium",
        "Good anti-inflammatory from ginger",
      ],
      estimatedPricePhp: 90,
      daysBack: 3,
    },
    {
      productName: "Pinakbet",
      foodType: "main meal",
      calories: 210,
      sugarGrams: 6.2,
      sodiumMg: 580,
      fatGrams: 9,
      proteinGrams: 9,
      fiberGrams: 7,
      score: 76,
      supportLevel: "High",
      wellnessImpact:
        "High fibre and micronutrients from mixed vegetables — bagoong adds sodium.",
      betterAlternatives: ["Pinakbet with less bagoong", "Ginisang gulay"],
      notes: ["Excellent fibre", "Sodium from bagoong"],
      estimatedPricePhp: 75,
      daysBack: 4,
    },
    {
      productName: "Grilled Bangus (Milkfish)",
      foodType: "main meal",
      calories: 350,
      sugarGrams: 0,
      sodiumMg: 290,
      fatGrams: 13,
      proteinGrams: 42,
      fiberGrams: 0,
      score: 90,
      supportLevel: "High",
      wellnessImpact:
        "Outstanding protein and omega-3 content — ideal for heart and sodium management.",
      betterAlternatives: [],
      notes: ["High omega-3", "Heart-healthy", "Low sodium"],
      estimatedPricePhp: 130,
      daysBack: 5,
    },
    {
      productName: "Palabok",
      foodType: "main meal",
      calories: 490,
      sugarGrams: 5.1,
      sodiumMg: 920,
      fatGrams: 18,
      proteinGrams: 21,
      fiberGrams: 2,
      score: 48,
      supportLevel: "Medium",
      wellnessImpact:
        "Tasty but high in sodium and refined carbs — occasional treat only for hypertension.",
      betterAlternatives: ["Bihon guisado with vegetables", "Sotanghon soup"],
      notes: ["High sodium", "Refined carbs", "Low fibre"],
      estimatedPricePhp: 85,
      daysBack: 6,
    },
    {
      productName: "Boiled Kamote (Sweet Potato)",
      foodType: "snack",
      calories: 130,
      sugarGrams: 6.5,
      sodiumMg: 55,
      fatGrams: 0.1,
      proteinGrams: 2.3,
      fiberGrams: 3.8,
      score: 93,
      supportLevel: "High",
      wellnessImpact:
        "One of the best local snacks — high potassium, fibre, and natural energy.",
      betterAlternatives: [],
      notes: ["High potassium", "Excellent fibre", "Low glycemic"],
      estimatedPricePhp: 20,
      daysBack: 7,
    },
    {
      productName: "Tapsilog (Beef Tapa)",
      foodType: "breakfast",
      calories: 680,
      sugarGrams: 4.8,
      sodiumMg: 1100,
      fatGrams: 28,
      proteinGrams: 36,
      fiberGrams: 1,
      score: 41,
      supportLevel: "Medium",
      wellnessImpact:
        "High sodium from cured beef and high fat — limit to once a week for hypertension.",
      betterAlternatives: [
        "Sinangag with boiled egg",
        "Lugaw",
        "Oatmeal with banana",
      ],
      notes: ["Very high sodium from curing", "High saturated fat"],
      estimatedPricePhp: 120,
      daysBack: 8,
    },
  ];

  for (const s of scanData) {
    const { daysBack, ...fields } = s;
    await prisma.foodScan.create({
      data: {
        ...fields,
        estimatedPriceCurrency: "PHP",
        profileId: judge.id,
        createdAt: daysAgo(daysBack),
        aiAnalysis: { source: "seed", model: "gemini-flash" },
      },
    });
  }

  // Diary entries — 5 days
  const diaryEntries = [
    {
      daysBack: 0,
      moodTag: "focused",
      energyLevel: 4,
      stressLevel: 2,
      sleepHours: 7,
      waterIntakeMl: 2200,
      activityMinutes: 40,
      entry:
        "Kept sodium low today. Had tinola for lunch and banana as snack. Felt good throughout the afternoon.",
      aiReflection:
        "Solid day for hypertension management — sodium stayed well within range. Potassium from banana helps balance sodium levels. Keep this pattern going.",
    },
    {
      daysBack: 2,
      moodTag: "tired",
      energyLevel: 2,
      stressLevel: 4,
      sleepHours: 5.5,
      waterIntakeMl: 1400,
      activityMinutes: 0,
      entry:
        "Had cup noodles for dinner — was in a rush. Felt sluggish afterward.",
      aiReflection:
        "Low sleep and the high-sodium cup noodles may be contributing to the fatigue. The 1,760 mg sodium in one serving is significant for someone managing hypertension. Prioritise easier home meals or instant oatmeal as a quick alternative.",
    },
    {
      daysBack: 4,
      moodTag: "calm",
      energyLevel: 3,
      stressLevel: 2,
      sleepHours: 7.5,
      waterIntakeMl: 2500,
      activityMinutes: 30,
      entry:
        "Pinakbet and rice for dinner. Good hydration today. Short evening walk.",
      aiReflection:
        "Great hydration and moderate activity. Pinakbet is high in fibre — the vegetable variety supports blood pressure management. Consider reducing the bagoong portion next time to lower sodium further.",
    },
    {
      daysBack: 6,
      moodTag: "energetic",
      energyLevel: 5,
      stressLevel: 1,
      sleepHours: 8,
      waterIntakeMl: 2800,
      activityMinutes: 60,
      entry:
        "Best day this week. Grilled bangus for lunch. Walked 45 minutes in the morning and 15 in the evening.",
      aiReflection:
        "Excellent wellness day — optimal sleep, strong hydration, and the highest activity this week. Bangus is rich in omega-3 which actively supports cardiovascular health. This is the benchmark day to aim for.",
    },
    {
      daysBack: 8,
      moodTag: "stressed",
      energyLevel: 2,
      stressLevel: 5,
      sleepHours: 5,
      waterIntakeMl: 900,
      activityMinutes: 0,
      entry:
        "Tapsilog for breakfast. Stressful work day. Forgot to drink water until evening.",
      aiReflection:
        "High stress combined with poor sleep and low hydration form a risky pattern for blood pressure. The tapsilog added over 1,100 mg sodium first thing in the morning. On high-stress days, try a lower-sodium breakfast like oatmeal or boiled eggs with fresh tomatoes.",
    },
  ];

  for (const d of diaryEntries) {
    const { daysBack, ...fields } = d;
    await prisma.diaryEntry.create({
      data: {
        ...fields,
        profileId: judge.id,
        createdAt: daysAgo(daysBack),
      },
    });
  }

  // Daily summaries — 14 days for calendar colour coding
  const summaryData = [
    {
      daysBack: 0,
      score: 82,
      level: "High",
      highlights: ["Low sodium meals", "Good hydration", "Banana snack"],
      suggestions: ["Add a second fruit serving"],
    },
    {
      daysBack: 1,
      score: 74,
      level: "High",
      highlights: ["Sinigang for lunch", "Banana snack"],
      suggestions: ["Reduce broth intake to lower sodium"],
    },
    {
      daysBack: 2,
      score: 31,
      level: "Low",
      highlights: [],
      suggestions: [
        "Avoid cup noodles",
        "Sleep at least 7 hours",
        "Drink more water",
      ],
    },
    {
      daysBack: 3,
      score: 85,
      level: "High",
      highlights: ["Tinola dinner", "Good sleep"],
      suggestions: ["Maintain this meal pattern"],
    },
    {
      daysBack: 4,
      score: 71,
      level: "High",
      highlights: ["Pinakbet", "Evening walk", "Good hydration"],
      suggestions: ["Reduce bagoong to lower sodium"],
    },
    {
      daysBack: 5,
      score: 88,
      level: "High",
      highlights: ["Grilled bangus", "Long walk"],
      suggestions: ["Keep omega-3 rich foods in rotation"],
    },
    {
      daysBack: 6,
      score: 62,
      level: "Medium",
      highlights: ["Palabok for lunch"],
      suggestions: ["Switch to lower-sodium noodle dishes"],
    },
    {
      daysBack: 7,
      score: 90,
      level: "High",
      highlights: ["Kamote snack", "High activity", "Best sleep this week"],
      suggestions: ["Replicate this day's meal plan"],
    },
    {
      daysBack: 8,
      score: 28,
      level: "Low",
      highlights: [],
      suggestions: [
        "Manage stress",
        "Prioritise sleep",
        "Stay hydrated",
        "Avoid cured meats",
      ],
    },
    {
      daysBack: 9,
      score: 68,
      level: "Medium",
      highlights: ["Decent hydration"],
      suggestions: ["Increase vegetable intake"],
    },
    {
      daysBack: 10,
      score: 77,
      level: "High",
      highlights: ["Home-cooked meals", "Morning walk"],
      suggestions: ["Add one more vegetable to lunch"],
    },
    {
      daysBack: 11,
      score: 55,
      level: "Medium",
      highlights: ["Moderate activity"],
      suggestions: ["Improve sleep quality", "Reduce processed food"],
    },
    {
      daysBack: 12,
      score: 80,
      level: "High",
      highlights: ["Consistent hydration", "Low sodium day"],
      suggestions: ["Keep up the low-sodium streak"],
    },
    {
      daysBack: 13,
      score: 43,
      level: "Medium",
      highlights: ["Some physical activity"],
      suggestions: ["Plan meals ahead to avoid impulse high-sodium choices"],
    },
  ];

  for (const s of summaryData) {
    const d = new Date();
    d.setDate(d.getDate() - s.daysBack);
    d.setHours(0, 0, 0, 0);
    await prisma.dailySummary.create({
      data: {
        profileId: judge.id,
        date: d,
        score: s.score,
        supportLevel: s.level,
        highlights: s.highlights,
        suggestions: s.suggestions,
        aiSummary: { source: "seed" },
      },
    });
  }

  // Water logs
  const waterLogs = [
    { daysBack: 0, amountMl: 500, note: "Morning" },
    { daysBack: 0, amountMl: 750, note: "Midday" },
    { daysBack: 0, amountMl: 950, note: "Afternoon" },
    { daysBack: 1, amountMl: 600, note: "Morning" },
    { daysBack: 1, amountMl: 800, note: "Evening" },
    { daysBack: 3, amountMl: 750, note: "Morning" },
    { daysBack: 3, amountMl: 1000, note: "Afternoon" },
    { daysBack: 4, amountMl: 500, note: "Morning" },
    { daysBack: 4, amountMl: 750, note: "Afternoon" },
    { daysBack: 4, amountMl: 1250, note: "Evening" },
  ];
  for (const w of waterLogs) {
    const { daysBack, ...fields } = w;
    await prisma.waterLog.create({
      data: {
        ...fields,
        profileId: judge.id,
        source: "manual",
        createdAt: daysAgo(daysBack),
      },
    });
  }

  // Sleep logs
  const sleepLogs = [
    { daysBack: 0, hours: 7, note: "Slept well" },
    { daysBack: 1, hours: 6.5, note: "Woke up once" },
    { daysBack: 2, hours: 5.5, note: "Late night, rushed morning" },
    { daysBack: 3, hours: 7.5, note: "Good rest" },
    { daysBack: 4, hours: 7, note: "Normal" },
    { daysBack: 5, hours: 8, note: "Best sleep of the week" },
    { daysBack: 6, hours: 6, note: "Restless" },
    { daysBack: 7, hours: 8, note: "Weekend catch-up" },
    { daysBack: 8, hours: 5, note: "Stressful night" },
  ];
  for (const s of sleepLogs) {
    const { daysBack, ...fields } = s;
    await prisma.sleepLog.create({
      data: {
        ...fields,
        profileId: judge.id,
        source: "manual",
        createdAt: daysAgo(daysBack),
      },
    });
  }

  // Workout logs
  await prisma.workoutLog.create({
    data: {
      profileId: judge.id,
      title: "Morning walk",
      workoutType: "walk",
      durationMinutes: 45,
      durationHours: 0.75,
      caloriesBurned: 210,
      distanceKm: 4.0,
      intensity: "moderate",
      source: "manual",
      notes: ["Felt great"],
      aiAnalysis: { source: "seed" },
      createdAt: daysAgo(5),
    },
  });
  await prisma.workoutLog.create({
    data: {
      profileId: judge.id,
      title: "Evening walk",
      workoutType: "walk",
      durationMinutes: 30,
      durationHours: 0.5,
      caloriesBurned: 140,
      distanceKm: 2.8,
      intensity: "light",
      source: "manual",
      notes: ["Cool down after dinner"],
      aiAnalysis: { source: "seed" },
      createdAt: daysAgo(4),
    },
  });
  await prisma.workoutLog.create({
    data: {
      profileId: judge.id,
      title: "Home bodyweight circuit",
      workoutType: "strength",
      durationMinutes: 25,
      durationHours: 0.42,
      caloriesBurned: 180,
      intensity: "moderate",
      source: "manual",
      notes: ["Push-ups, squats, plank"],
      aiAnalysis: { source: "seed" },
      createdAt: daysAgo(1),
    },
  });

  // Budget logs
  const budgetItems = [
    { title: "Palengke groceries", amount: 850, daysBack: 6 },
    { title: "Bangus grilled", amount: 130, daysBack: 5 },
    { title: "Cup noodles (x2)", amount: 70, daysBack: 2 },
    { title: "Banana bunch", amount: 60, daysBack: 1 },
    { title: "Chicken adobo meal", amount: 95, daysBack: 0 },
  ];
  for (const b of budgetItems) {
    await prisma.foodBudgetLog.create({
      data: {
        profileId: judge.id,
        title: b.title,
        amount: b.amount,
        currency: "PHP",
        category: "food",
        entryType: "spent",
        spentAt: daysAgo(b.daysBack),
        createdAt: daysAgo(b.daysBack),
      },
    });
  }

  // Wellness task
  await prisma.wellnessTask.create({
    data: {
      profileId: judge.id,
      title: "Replace one high-sodium meal per day",
      reason:
        "Managing hypertension requires keeping daily sodium under 1,500 mg. One swap can cut intake by 30–40%.",
      action:
        "Swap tapsilog or cup noodles for tinola, lugaw, or grilled fish.",
      category: "food",
      priority: "High",
      status: "suggested",
      source: "ai",
      aiPayload: { source: "seed" },
    },
  });

  console.log("Seed complete:", {
    parent: parent.email,
    child: child.email,
    individual: individual.email,
    judge: judge.email,
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
