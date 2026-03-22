export interface SubQuestion {
  id: string;
  question: string;
  status: "pending" | "running" | "done" | "error";
  answer?: string;
  sources: Source[];
}

export interface Source {
  type: "vector_store" | "web_search" | "page_index";
  title: string;
  url?: string;
  snippet?: string;
}

export interface PageIndexDocument {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  pageNum: number;
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

export interface SavedMemory {
  id: string;              // UUID
  collectionId: string;    // Collection reference
  userQuestion: string;    // Original Frage
  assistantAnswer: string; // Finale Antwort
  createdAt: string;       // ISO timestamp
}

export interface MemoryCollection {
  id: string;              // UUID
  name: string;            // "Betrug Fälle", "Notwehr"
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
}

export interface MemoryState {
  collections: MemoryCollection[];
  activeCollectionId: string | null;
}
