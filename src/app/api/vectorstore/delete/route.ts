import { NextRequest, NextResponse } from "next/server";
import { openai, VECTOR_STORE_ID } from "@/lib/openai";

export async function POST(req: NextRequest) {
  try {
    const { fileId } = await req.json();

    if (!fileId) {
      return NextResponse.json(
        { error: "Keine Datei-ID angegeben" },
        { status: 400 }
      );
    }

    // Remove from vector store
    await openai.vectorStores.files.delete(fileId, {
      vector_store_id: VECTOR_STORE_ID,
    });

    // Delete the file itself
    await openai.files.delete(fileId);

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Löschen fehlgeschlagen";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
