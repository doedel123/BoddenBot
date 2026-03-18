import { openai, VECTOR_STORE_ID } from "@/lib/openai";
import { claudeCreate, claudeStream, CLAUDE_MODEL_PRIMARY, CLAUDE_MODEL_FALLBACK } from "@/lib/claude";
import { SubQuestion, Source } from "@/lib/types";

export const maxDuration = 300;

function log(step: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${step}] ${msg}`, data !== undefined ? data : "");
}

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
  log("DECOMPOSE", "Calling Claude for decomposition", { primary: CLAUDE_MODEL_PRIMARY, fallback: CLAUDE_MODEL_FALLBACK });

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

  try {
    const response = await claudeCreate({
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    });

    log("DECOMPOSE", "Claude response OK", {
      model: response.model,
      stop_reason: response.stop_reason,
      blocks: response.content.length,
    });

    const raw =
      response.content.find((b) => b.type === "text")?.text ?? "{}";
    log("DECOMPOSE", "Raw content", raw.substring(0, 200));

    // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
    const content = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    const parsed = JSON.parse(content);
    const questions = parsed.questions || parsed.sub_questions || parsed;
    const result = Array.isArray(questions) ? questions : [question];
    log("DECOMPOSE", `Decomposed into ${result.length} sub-questions`, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("DECOMPOSE", "ERROR", msg);
    throw err;
  }
}

// ── Step 2a: Retrieve from OpenAI Vector Store ───────────────────────
async function retrieveFromVectorStore(
  question: string,
  id: string
): Promise<Source[]> {
  log("VECTOR", `[${id}] Calling OpenAI file_search`);
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
    log("VECTOR", `[${id}] Got ${sources.length} sources`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("VECTOR", `[${id}] ERROR: ${msg}`);
    // non-fatal – continue without vector store results
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
  log("SUB", `[${subQ.id}] Starting: "${subQ.question.substring(0, 60)}..."`);

  const allSources: Source[] = [];
  let answer = "";

  try {
    // 2a: Retrieve from vector store
    const vsSources = await retrieveFromVectorStore(subQ.question, subQ.id);
    allSources.push(...vsSources);

    const vsContext = vsSources
      .map((s) => `[${s.title}]: ${s.snippet || ""}`)
      .join("\n\n");

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

    log("SUB", `[${subQ.id}] Calling Claude streaming`);

    // 2b: Stream answer from Claude with web search
    const stream = claudeStream({
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: subQ.question }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        },
      ],
    } as Parameters<typeof claude.messages.stream>[0]);

    let eventCount = 0;
    for await (const event of stream) {
      eventCount++;
      if (event.type === "message_start") {
        log("SUB", `[${subQ.id}] Stream started`);
      }
      if (event.type === "message_stop") {
        log("SUB", `[${subQ.id}] Stream stopped after ${eventCount} events`);
      }
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

    log("SUB", `[${subQ.id}] Stream done, answer length: ${answer.length}`);

    // Extract web search citations
    try {
      const finalMessage = await stream.finalMessage();
      log("SUB", `[${subQ.id}] Final message stop_reason: ${finalMessage.stop_reason}`);
      for (const block of finalMessage.content) {
        if (block.type === "text") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const citations = (block as unknown as { citations?: unknown[] }).citations;
          if (citations) {
            for (const citation of citations) {
              const c = citation as { type?: string; url?: string; title?: string };
              if (c.type === "web_search_result_location" && c.url) {
                allSources.push({
                  type: "web_search",
                  title: c.title || c.url,
                  url: c.url,
                });
              }
            }
          }
        }
      }
    } catch (citErr) {
      log("SUB", `[${subQ.id}] Citation extraction error (non-fatal)`, citErr instanceof Error ? citErr.message : citErr);
    }

    // Deduplicate sources
    const seen = new Set<string>();
    const uniqueSources = allSources.filter((s) => {
      const key = s.type + ":" + s.title + (s.url || "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    log("SUB", `[${subQ.id}] Done. Sources: ${uniqueSources.length}`);

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
    log("SUB", `[${subQ.id}] CAUGHT ERROR: ${errMsg}`);
    sendEvent(controller, "sub_question_done", {
      id: subQ.id,
      answer: `**Fehler:** ${errMsg}`,
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
  log("SYNTH", `Synthesizing ${subResults.length} sub-answers`);
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

  try {
    log("SYNTH", "Calling Claude streaming for synthesis");

    const stream = claudeStream({
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Ursprüngliche Frage: ${question}\n\nTeilantworten:\n${resultsText}\n\nErstelle eine zusammenfassende Analyse.`,
        },
      ],
    });

    let chars = 0;
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        chars += event.delta.text.length;
        sendEvent(controller, "synthesis_delta", { delta: event.delta.text });
      }
    }
    log("SYNTH", `Done. Chars streamed: ${chars}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("SYNTH", `ERROR: ${msg}`);
    sendEvent(controller, "synthesis_delta", {
      delta: `\n\n**Fehler bei Synthese:** ${msg}`,
    });
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

  log("MAIN", `New request: "${message.substring(0, 80)}"`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: Decompose
        sendEvent(controller, "status", { message: "Analysiere die Frage..." });
        const questions = await decomposeQuestion(message, context || "");

        const subQuestions: SubQuestion[] = questions.map((q, i) => ({
          id: `sq-${i}`,
          question: q,
          status: "pending" as const,
          sources: [],
        }));

        sendEvent(controller, "sub_questions", { subQuestions });

        // Step 2: Answer in parallel
        sendEvent(controller, "status", { message: "Bearbeite Teilfragen parallel..." });
        log("MAIN", `Running ${subQuestions.length} sub-questions in parallel`);

        const results = await Promise.all(
          subQuestions.map((sq) =>
            answerSubQuestion(sq, context || "", controller)
          )
        );

        log("MAIN", `All sub-questions done. Errors: ${results.filter(r => r.status === "error").length}`);

        // Step 3: Synthesize
        if (results.length > 1) {
          sendEvent(controller, "status", { message: "Erstelle Gesamtanalyse..." });
          await synthesize(message, results, context || "", controller);
        } else {
          sendEvent(controller, "synthesis_done", { single: true });
        }

        log("MAIN", "Request completed successfully");
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : "Unbekannter Fehler";
        log("MAIN", `TOP-LEVEL ERROR: ${errMsg}`);
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
