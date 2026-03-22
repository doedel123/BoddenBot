import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "edge";

// GET /api/memories/[collectionId] - Alle Memories einer Collection abrufen
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  try {
    const { collectionId } = await params;
    const sql = neon(process.env.DATABASE_URL!);

    const memories = await sql`
      SELECT id, collection_id, user_question, assistant_answer, created_at
      FROM saved_memories
      WHERE collection_id = ${collectionId}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({
      memories: memories.map((m) => ({
        id: m.id,
        collectionId: m.collection_id,
        userQuestion: m.user_question,
        assistantAnswer: m.assistant_answer,
        createdAt: m.created_at,
      })),
    });
  } catch (error) {
    console.error("Error fetching memories:", error);
    return NextResponse.json(
      { error: "Failed to fetch memories" },
      { status: 500 }
    );
  }
}

// POST /api/memories/[collectionId] - Neues Memory zur Collection hinzufügen
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  try {
    const { collectionId } = await params;
    const body = await request.json();
    const { userQuestion, assistantAnswer } = body;

    if (
      !userQuestion ||
      !assistantAnswer ||
      typeof userQuestion !== "string" ||
      typeof assistantAnswer !== "string"
    ) {
      return NextResponse.json(
        { error: "userQuestion and assistantAnswer are required" },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Update collection's updated_at
    await sql`
      UPDATE memory_collections
      SET updated_at = NOW()
      WHERE id = ${collectionId}
    `;

    // Insert memory
    const result = await sql`
      INSERT INTO saved_memories (collection_id, user_question, assistant_answer)
      VALUES (${collectionId}, ${userQuestion}, ${assistantAnswer})
      RETURNING id, collection_id, user_question, assistant_answer, created_at
    `;

    const memory = result[0];

    return NextResponse.json({
      memory: {
        id: memory.id,
        collectionId: memory.collection_id,
        userQuestion: memory.user_question,
        assistantAnswer: memory.assistant_answer,
        createdAt: memory.created_at,
      },
    });
  } catch (error) {
    console.error("Error creating memory:", error);
    return NextResponse.json(
      { error: "Failed to create memory" },
      { status: 500 }
    );
  }
}
