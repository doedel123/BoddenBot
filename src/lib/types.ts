export interface SubQuestion {
  id: string;
  question: string;
  status: "pending" | "running" | "done" | "error";
  answer?: string;
  sources: Source[];
}

export interface Source {
  type: "vector_store" | "web_search";
  title: string;
  url?: string;
  snippet?: string;
}

export interface StreamEvent {
  type:
    | "status"
    | "sub_questions"
    | "sub_question_start"
    | "sub_question_delta"
    | "sub_question_done"
    | "sub_question_sources"
    | "synthesis_start"
    | "synthesis_delta"
    | "synthesis_done"
    | "error";
  data: unknown;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  subQuestions?: SubQuestion[];
}
