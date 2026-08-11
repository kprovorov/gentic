import "@testing-library/jest-dom/vitest"
import "fake-indexeddb/auto"
import { vi } from "vitest"

// Every issue surface that can attach a file now holds a Supabase client, so
// it can PUT the bytes straight into Storage under a signed ticket. The real
// hook reads a Clerk session that jsdom has no way to provide; a file that
// cares what was uploaded re-mocks this module with its own spy.
vi.mock("@gentic/supabase/client", () => ({
  useSupabaseClient: () => ({
    storage: {
      from: () => ({
        uploadToSignedUrl: async () => ({ error: null }),
      }),
    },
  }),
}))
