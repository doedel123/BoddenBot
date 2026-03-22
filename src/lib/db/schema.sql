-- Memory Collections Table
CREATE TABLE IF NOT EXISTS memory_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Saved Memories Table
CREATE TABLE IF NOT EXISTS saved_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES memory_collections(id) ON DELETE CASCADE,
  user_question TEXT NOT NULL,
  assistant_answer TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_collection FOREIGN KEY (collection_id) REFERENCES memory_collections(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memories_collection ON saved_memories(collection_id);
CREATE INDEX IF NOT EXISTS idx_memories_created ON saved_memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_created ON memory_collections(created_at DESC);
