import { getDb } from "../lib/db/index";
import { checklistItems, objects, objectUpdates } from "../lib/db/schema";
import { seedObjects } from "../lib/data/seed-objects";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
    );
    process.exit(1);
  }

  const db = getDb();

  // Wipe the tables first so re-running the seed is idempotent.
  await db.delete(objectUpdates);
  await db.delete(checklistItems);
  await db.delete(objects);

  for (const seedObject of seedObjects) {
    await db.insert(objects).values({
      id: seedObject.id,
      title: seedObject.title,
      status: seedObject.status,
      goal: seedObject.goal,
      currentState: seedObject.currentState,
      nextAction: seedObject.nextAction,
    });

    await db.insert(checklistItems).values(
      seedObject.checklist.map((item, index) => ({
        id: `${seedObject.id}-${index + 1}`,
        objectId: seedObject.id,
        parentId: null,
        title: item.title,
        completed: item.completed,
        position: index,
      })),
    );

    await db.insert(objectUpdates).values({
      id: `${seedObject.id}-created`,
      objectId: seedObject.id,
      type: "object_created",
      content: seedObject.title,
    });
  }

  console.log(`Seeded ${seedObjects.length} objects.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});

