import { neon } from "@neondatabase/serverless";

/**
 * Initialisiert die Datenbank mit dem Schema
 * Nur einmalig ausführen
 */
async function initDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  console.log("🔧 Initializing database schema...");

  const sql = neon(databaseUrl);

  try {
    // Erstelle memory_collections Tabelle
    await sql`
      CREATE TABLE IF NOT EXISTS memory_collections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log("✓ Created memory_collections table");

    // Erstelle saved_memories Tabelle
    await sql`
      CREATE TABLE IF NOT EXISTS saved_memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id UUID NOT NULL REFERENCES memory_collections(id) ON DELETE CASCADE,
        user_question TEXT NOT NULL,
        assistant_answer TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT fk_collection FOREIGN KEY (collection_id) REFERENCES memory_collections(id)
      )
    `;
    console.log("✓ Created saved_memories table");

    // Erstelle Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_memories_collection ON saved_memories(collection_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memories_created ON saved_memories(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_collections_created ON memory_collections(created_at DESC)`;
    console.log("✓ Created indexes");

    console.log("✅ Database schema initialized successfully!");
    return { success: true };
  } catch (error) {
    console.error("✗ Database initialization failed:", error);
    throw error;
  }
}

// Führe aus
initDatabase()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
