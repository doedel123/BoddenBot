import { openai, VECTOR_STORE_ID, MODEL } from "@/lib/openai";
import { SubQuestion, Source } from "@/lib/types";

export const maxDuration = 120;

function sendEvent(
  controller: ReadableStreamDefaultController,
  type: string,
  data: unknown
) {
  const payload = JSON.stringify({ type, data });
  controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
}

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
- Antworte mit einem JSON-Objekt: {"questions": ["Frage 1", "Frage 2", ...]}`;

  const userMsg = context
    ? `Kontext aus hochgeladenen Dokumenten:\n${context}\n\nFrage: ${question}`
    : question;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content || "[]";
  try {
    const parsed = JSON.parse(content);
    const questions = parsed.questions || parsed.sub_questions || parsed;
    return Array.isArray(questions) ? questions : [question];
  } catch {
    return [question];
  }
}

async function answerSubQuestion(
  subQ: SubQuestion,
  context: string,
  controller: ReadableStreamDefaultController
): Promise<SubQuestion> {
  sendEvent(controller, "sub_question_start", { id: subQ.id });

  const sources: Source[] = [];
  let answer = "";

  try {
    const systemPrompt = `Du bist ein hochqualifizierter juristischer Assistent für deutsches Strafrecht. Du hast Zugriff auf StGB- und StPO-Kommentare über den Vector Store sowie Websuche für aktuelle Rechtsprechung.

Antworte präzise und fundiert. Zitiere relevante Paragraphen und Kommentarstellen. Nutze Markdown-Formatierung.
${context ? `\nKontext aus hochgeladenen Dokumenten:\n${context}` : ""}`;

    const stream = await openai.responses.create({
      model: MODEL,
      instructions: systemPrompt,
      input: subQ.question,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        },
        {
          type: "web_search",
        },
      ],
      reasoning: {
        effort: "medium",
      },
      stream: true,
    });

    for await (const event of stream) {
      if (
        event.type === "response.output_text.delta"
      ) {
        answer += event.delta;
        sendEvent(controller, "sub_question_delta", {
          id: subQ.id,
          delta: event.delta,
        });
      }

      // Collect file search sources
      if (event.type === "response.completed") {
        const output = event.response?.output;
        if (output && Array.isArray(output)) {
          for (const item of output) {
            if (item.type === "file_search_call" && item.results) {
              for (const result of item.results) {
                sources.push({
                  type: "vector_store",
                  title: result.filename || "Kommentar",
                  snippet: result.text?.substring(0, 200),
                });
              }
            }
            // Web search results are captured via annotations below
            // Check for message content with annotations
            if (item.type === "message" && item.content) {
              for (const block of item.content) {
                if (block.type === "output_text" && block.annotations) {
                  for (const ann of block.annotations) {
                    if (ann.type === "url_citation") {
                      sources.push({
                        type: "web_search",
                        title: ann.title || ann.url,
                        url: ann.url,
                      });
                    }
                    if (ann.type === "file_citation") {
                      sources.push({
                        type: "vector_store",
                        title: ann.filename || "Kommentar",
                        snippet: ann.file_id || undefined,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Deduplicate sources
    const seen = new Set<string>();
    const uniqueSources = sources.filter((s) => {
      const key = s.title + (s.url || "");
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
    return { ...subQ, status: "error", answer: `Fehler: ${errMsg}`, sources };
  }
}

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

  const stream = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Ursprüngliche Frage: ${question}\n\nTeilantworten:\n${resultsText}\n\nErstelle eine zusammenfassende Analyse.`,
      },
    ],
    stream: true,
    temperature: 0.4,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      sendEvent(controller, "synthesis_delta", { delta });
    }
  }

  sendEvent(controller, "synthesis_done", {});
}

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
          // Single question - the sub-question answer IS the final answer
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
