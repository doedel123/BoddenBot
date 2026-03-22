"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { MemoryCollection, SavedMemory } from "@/lib/types";

interface MemoryContextType {
  collections: MemoryCollection[];
  activeCollectionId: string | null;
  loading: boolean;

  // Actions
  loadCollections: () => Promise<void>;
  createCollection: (name: string) => Promise<MemoryCollection | null>;
  setActiveCollection: (id: string | null) => void;
  loadMemories: (collectionId: string) => Promise<SavedMemory[]>;
  saveMemory: (
    collectionId: string,
    userQuestion: string,
    assistantAnswer: string
  ) => Promise<SavedMemory | null>;
  deleteMemory: (collectionId: string, memoryId: string) => Promise<boolean>;
  deleteCollection: (collectionId: string) => Promise<boolean>;
  renameCollection: (collectionId: string, newName: string) => Promise<boolean>;
}

const MemoryContext = createContext<MemoryContextType | undefined>(undefined);

export function MemoryProvider({ children }: { children: React.ReactNode }) {
  const [collections, setCollections] = useState<MemoryCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const loadCollections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memories/collections");
      const data = await res.json();

      if (res.ok && data.collections) {
        setCollections(data.collections);
      } else {
        console.error("Failed to load collections:", data.error);
      }
    } catch (error) {
      console.error("Error loading collections:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const createCollection = useCallback(
    async (name: string): Promise<MemoryCollection | null> => {
      try {
        const res = await fetch("/api/memories/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });

        const data = await res.json();

        if (res.ok && data.collection) {
          setCollections((prev) => [data.collection, ...prev]);
          return data.collection;
        } else {
          console.error("Failed to create collection:", data.error);
          return null;
        }
      } catch (error) {
        console.error("Error creating collection:", error);
        return null;
      }
    },
    []
  );

  const loadMemories = useCallback(
    async (collectionId: string): Promise<SavedMemory[]> => {
      try {
        const res = await fetch(`/api/memories/${collectionId}`);
        const data = await res.json();

        if (res.ok && data.memories) {
          return data.memories;
        } else {
          console.error("Failed to load memories:", data.error);
          return [];
        }
      } catch (error) {
        console.error("Error loading memories:", error);
        return [];
      }
    },
    []
  );

  const saveMemory = useCallback(
    async (
      collectionId: string,
      userQuestion: string,
      assistantAnswer: string
    ): Promise<SavedMemory | null> => {
      try {
        const res = await fetch(`/api/memories/${collectionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userQuestion, assistantAnswer }),
        });

        const data = await res.json();

        if (res.ok && data.memory) {
          // Update collection's updatedAt in local state
          setCollections((prev) =>
            prev.map((c) =>
              c.id === collectionId ? { ...c, updatedAt: new Date().toISOString() } : c
            )
          );
          return data.memory;
        } else {
          console.error("Failed to save memory:", data.error);
          return null;
        }
      } catch (error) {
        console.error("Error saving memory:", error);
        return null;
      }
    },
    []
  );

  const deleteMemory = useCallback(
    async (collectionId: string, memoryId: string): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/memories/${collectionId}/${memoryId}`,
          {
            method: "DELETE",
          }
        );

        const data = await res.json();

        if (res.ok && data.success) {
          return true;
        } else {
          console.error("Failed to delete memory:", data.error);
          return false;
        }
      } catch (error) {
        console.error("Error deleting memory:", error);
        return false;
      }
    },
    []
  );

  const deleteCollection = useCallback(
    async (collectionId: string): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/memories/collections/${collectionId}`,
          {
            method: "DELETE",
          }
        );

        const data = await res.json();

        if (res.ok && data.success) {
          setCollections((prev) => prev.filter((c) => c.id !== collectionId));
          if (activeCollectionId === collectionId) {
            setActiveCollectionId(null);
          }
          return true;
        } else {
          console.error("Failed to delete collection:", data.error);
          return false;
        }
      } catch (error) {
        console.error("Error deleting collection:", error);
        return false;
      }
    },
    [activeCollectionId]
  );

  const renameCollection = useCallback(
    async (collectionId: string, newName: string): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/memories/collections/${collectionId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName }),
          }
        );

        const data = await res.json();

        if (res.ok && data.collection) {
          setCollections((prev) =>
            prev.map((c) => (c.id === collectionId ? data.collection : c))
          );
          return true;
        } else {
          console.error("Failed to rename collection:", data.error);
          return false;
        }
      } catch (error) {
        console.error("Error renaming collection:", error);
        return false;
      }
    },
    []
  );

  return (
    <MemoryContext.Provider
      value={{
        collections,
        activeCollectionId,
        loading,
        loadCollections,
        createCollection,
        setActiveCollection: setActiveCollectionId,
        loadMemories,
        saveMemory,
        deleteMemory,
        deleteCollection,
        renameCollection,
      }}
    >
      {children}
    </MemoryContext.Provider>
  );
}

export function useMemory() {
  const context = useContext(MemoryContext);
  if (context === undefined) {
    throw new Error("useMemory must be used within a MemoryProvider");
  }
  return context;
}
