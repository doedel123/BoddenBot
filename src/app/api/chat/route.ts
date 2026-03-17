import { openai, VECTOR_STORE_ID } from "@/lib/openai";
import { claude, CLAUDE_MODEL } from "@/lib/claude";
import { SubQuestion, Source } from "@/lib/types";

export const maxDuration = 300;

function sendEvent(
  controller: ReadableStreamDefaultController,
  type: string,
  data: unknown
) {
  const payload = JSON.stringify({ type, data });
  controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
}

// ── Step 1: Decompose question using Claude ──────────────────────────
async function decomposeQuestion(
  question: string,
  context: string
): Promise<string[]> {
  const systemPrompt = `Du bist ein juristischer Analyse-Assistent. Deine Aufgabe ist es, juristische Fragen in präzise Teilfragen aufzuteilen, die parallel recherchiert werden können.

WICHTIG: Teile die Frage IMMER auf, wenn sie:
- Mehrere Rechtsbegriffe oder Paragraphen erwähnt (z.B. "§ 32 und § 34" → 2 Teilfragen)
- Verschiedene Rechtsgebiete berührt (z.B. StGB und StPO → separate Teilfragen)
- Einen Vergleich verlangt (→ je eine Teilfrage pro Vergleichsobjekt)
- Mehrere Sätze mit unterschiedlichen Fragen enthält

Regeln:
- Teile in 2-5 Teilfragen auf, wenn die Frage komplex ist
- NUR bei wirklich einfachen Einzelfragen (ein Paragraph, ein Thema) gib eine einzige Frage zurück
- Jede Teilfrage muss eigenständig beantwortbar sein und ausreichend Kontext enthalten
- Antworte NUR mit einem JSON-Objekt: {"questions": ["Frage 1", "Frage 2", ...]}`;

  const userMsg = context
    ? `Kontext aus hochgeladenen Dokumenten:\n${context}\n\nFrage: ${question}`
    : question;

  const response = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userMsg }],
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "{}";
  try {
    const parsed = JSON.parse(content);
    const questions = parsed.questions || parsed.sub_questions || parsed;
    return Array.isArray(questions) ? questions : [question];
  } catch {
    return [question];
  }
}

// ── Step 2a: Retrieve from OpenAI Vector Store ───────────────────────
async function retrieveFromVectorStore(
  question: string
): Promise<Source[]> {
  const sources: Source[] = [];
  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-nano",
      input: question,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        },
      ],
    });

    const output = response.output;
    if (output && Array.isArray(output)) {
      for (const item of output) {
        if (
          item.type === "file_search_call" &&
          "results" in item &&
          Array.isArray(item.results)
        ) {
          for (const result of item.results) {
            sources.push({
              type: "vector_store",
              title: result.filename || "Kommentar",
              snippet: result.text?.substring(0, 500),
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("Vector store retrieval error:", err);
  }
  return sources;
}

// ── Step 2b: Answer sub-question with Claude + web search ────────────
async function answerSubQuestion(
  subQ: SubQuestion,
  context: string,
  controller: ReadableStreamDefaultController
): Promise<SubQuestion> {
  sendEvent(controller, "sub_question_start", { id: subQ.id });

  const allSources: Source[] = [];
  let answer = "";

  try {
    // 2a: Retrieve from vector store
    const vsSources = await retrieveFromVectorStore(subQ.question);
    allSources.push(...vsSources);

    // Build context from vector store results
    const vsContext = vsSources
      .map((s) => `[${s.title}]: ${s.snippet || ""}`)
      .join("\n\n");

    // Send vector store sources immediately
    if (vsSources.length > 0) {
      sendEvent(controller, "sub_question_sources", {
        id: subQ.id,
        sources: vsSources,
      });
    }

    const systemPrompt = `Du bist ein hochqualifizierter juristischer Assistent für deutsches Strafrecht.
Du hast Zugriff auf Websuche für aktuelle Rechtsprechung.

Antworte präzise und fundiert. Zitiere relevante Paragraphen und Kommentarstellen. Nutze Markdown-Formatierung.

${vsContext ? `Ergebnisse aus StGB/StPO-Kommentaren (Vector Store):\n${vsContext}` : ""}
${context ? `\nKontext aus hochgeladenen Dokumenten:\n${context}` : ""}`;

    // 2b: Stream answer from Claude with web search + adaptive thinking
    const stream = claude.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: systemPrompt,
      messages: [{ role: "user", content: subQ.question }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        },
      ],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        answer += event.delta.text;
        sendEvent(controller, "sub_question_delta", {
          id: subQ.id,
          delta: event.delta.text,
        });
      }
    }

    // Extract web search citations from final message
    const finalMessage = await stream.finalMessage();
    for (const block of finalMessage.content) {
      if (block.type === "text" && block.citations) {
        for (const citation of block.citations) {
          if (
            citation.type === "web_search_result_location" &&
            citation.url
          ) {
            allSources.push({
              type: "web_search",
              title: citation.title || citation.url,
              url: citation.url,
            });
          }
        }
      }
    }

    // Deduplicate sources
    const seen = new Set<string>();
    const uniqueSources = allSources.filter((s) => {
      const key = s.type + ":" + s.title + (s.url || "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    sendEvent(controller, "sub_question_sources", {
      id: subQ.id,
      sources: uniqueSources,
    });
    sendEvent(controller, "sub_question_done", {
      id: subQ.id,
      answer,
    });

    return { ...subQ, status: "done", answer, sources: uniqueSources };
  } catch (error) {
    const errMsg =
      error instanceof Error ? error.message : "Unbekannter Fehler";
    sendEvent(controller, "sub_question_done", {
      id: subQ.id,
      answer: `Fehler: ${errMsg}`,
      error: true,
    });
    return {
      ...subQ,
      status: "error",
      answer: `Fehler: ${errMsg}`,
      sources: allSources,
    };
  }
}

// ── Step 3: Synthesize with Claude ───────────────────────────────────
async function synthesize(
  question: string,
  subResults: SubQuestion[],
  context: string,
  controller: ReadableStreamDefaultController
) {
  sendEvent(controller, "synthesis_start", {});

  const resultsText = subResults
    .map(
      (sq) =>
        `### Teilfrage: ${sq.question}\n${sq.answer || "Keine Antwort"}\n`
    )
    .join("\n---\n");

  const systemPrompt = `Du bist ein hochqualifizierter juristischer Assistent für deutsches Strafrecht. Erstelle eine umfassende, strukturierte Synthese der Teilantworten.

Regeln:
- Nutze Markdown-Formatierung (Überschriften, Fettdruck, Listen)
- Strukturiere die Antwort logisch
- Verweise auf relevante Paragraphen (§§)
- Identifiziere Zusammenhänge zwischen den Teilantworten
- Gib eine klare Gesamteinschätzung
${context ? `\nKontext aus hochgeladenen Dokumenten:\n${context}` : ""}`;

  const stream = claude.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Ursprüngliche Frage: ${question}\n\nTeilantworten:\n${resultsText}\n\nErstelle eine zusammenfassende Analyse.`,
      },
    ],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      sendEvent(controller, "synthesis_delta", { delta: event.delta.text });
    }
  }

  sendEvent(controller, "synthesis_done", {});
}

// ── Main handler ─────────────────────────────────────────────────────
export async function POST(req: Request) {
  const body = await req.json();
  const { message, context } = body as {
    message: string;
    context?: string;
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: Decompose question
        sendEvent(controller, "status", {
          message: "Analysiere die Frage...",
        });
        const questions = await decomposeQuestion(message, context || "");

        const subQuestions: SubQuestion[] = questions.map((q, i) => ({
          id: `sq-${i}`,
          question: q,
          status: "pending" as const,
          sources: [],
        }));

        sendEvent(controller, "sub_questions", { subQuestions });

        // Step 2: Answer sub-questions in parallel
        sendEvent(controller, "status", {
          message: "Bearbeite Teilfragen parallel...",
        });

        const results = await Promise.all(
          subQuestions.map((sq) =>
            answerSubQuestion(sq, context || "", controller)
          )
        );

        // Step 3: Synthesize if multiple sub-questions
        if (results.length > 1) {
          sendEvent(controller, "status", {
            message: "Erstelle Gesamtanalyse...",
          });
          await synthesize(message, results, context || "", controller);
        } else {
          sendEvent(controller, "synthesis_done", { single: true });
        }
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : "Unbekannter Fehler";
        sendEvent(controller, "error", { message: errMsg });
      } finally {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
