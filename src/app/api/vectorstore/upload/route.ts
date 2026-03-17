import { NextRequest, NextResponse } from "next/server";
import { openai, VECTOR_STORE_ID } from "@/lib/openai";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Keine Datei hochgeladen" },
        { status: 400 }
      );
    }

    const filename = file.name.toLowerCase();
    if (!filename.endsWith(".pdf") && !filename.endsWith(".md") && !filename.endsWith(".txt")) {
      return NextResponse.json(
        { error: "Nur PDF, MD und TXT Dateien werden unterstützt" },
        { status: 400 }
      );
    }

    // Upload file to OpenAI
    const uploadedFile = await openai.files.create({
      file,
      purpose: "assistants",
    });

    // Add to vector store
    await openai.vectorStores.files.create(VECTOR_STORE_ID, {
      file_id: uploadedFile.id,
    });

    return NextResponse.json({
      success: true,
      fileId: uploadedFile.id,
      filename: file.name,
      size: file.size,
    });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Vector Store Upload fehlgeschlagen";
    console.error("Vector store upload error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// List files in vector store
export async function GET() {
  try {
    const files = await openai.vectorStores.files.list(VECTOR_STORE_ID);
    const fileDetails = await Promise.all(
      files.data.map(async (f) => {
        try {
          const detail = await openai.files.retrieve(f.id);
          return {
            id: f.id,
            filename: detail.filename,
            size: detail.bytes,
            status: f.status,
            createdAt: detail.created_at,
          };
        } catch {
          return {
            id: f.id,
            filename: "Unbekannt",
            size: 0,
            status: f.status,
            createdAt: 0,
          };
        }
      })
    );

    return NextResponse.json({ files: fileDetails });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Fehler beim Laden der Dateien";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
