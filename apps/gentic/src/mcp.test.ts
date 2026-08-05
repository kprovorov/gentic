import assert from "node:assert/strict"
import test from "node:test"

import type { McpServer } from "@agentclientprotocol/sdk"

import {
  GENTIC_MCP_SERVER_NAME,
  genticMcpServer,
  withGenticMcpServer,
} from "./mcp.js"

const access = {
  apiUrl: "https://app.gentic.chat/api/v1",
  credential: "gtwc_worker-credential",
}

test("the Gentic MCP server points at the app origin with a bearer credential", () => {
  assert.deepEqual(genticMcpServer(access), {
    type: "http",
    name: GENTIC_MCP_SERVER_NAME,
    url: "https://app.gentic.chat/mcp",
    headers: [
      { name: "Authorization", value: "Bearer gtwc_worker-credential" },
    ],
  })
})

test("the MCP url is resolved against the origin, not the versioned api path", () => {
  for (const apiUrl of [
    "http://localhost:3000/api/v1",
    "http://localhost:3000/api/v1/",
    "http://localhost:3000",
  ]) {
    assert.equal(
      genticMcpServer({ ...access, apiUrl })?.url,
      "http://localhost:3000/mcp",
      apiUrl
    )
  }
})

test("unusable access details yield no server instead of throwing", () => {
  assert.equal(genticMcpServer({ ...access, apiUrl: "not a url" }), null)
  assert.equal(genticMcpServer({ ...access, credential: "" }), null)
})

test("injection appends to existing servers instead of replacing them", () => {
  const existing: McpServer[] = [
    { name: "docs", command: "/usr/bin/docs-mcp", args: [], env: [] },
  ]

  const servers = withGenticMcpServer(existing, access)

  assert.equal(servers.length, 2)
  assert.deepEqual(servers[0], existing[0])
  assert.equal(servers[1]?.name, GENTIC_MCP_SERVER_NAME)
  // The caller's array is left untouched.
  assert.equal(existing.length, 1)
})

test("an explicitly configured gentic server is not overwritten", () => {
  const existing: McpServer[] = [
    {
      type: "http",
      name: GENTIC_MCP_SERVER_NAME,
      url: "https://self-hosted.example/mcp",
      headers: [],
    },
  ]

  assert.deepEqual(withGenticMcpServer(existing, access), existing)
})

test("no access details leaves the server list untouched", () => {
  assert.deepEqual(withGenticMcpServer([], null), [])
  assert.deepEqual(withGenticMcpServer([], undefined), [])
  assert.deepEqual(
    withGenticMcpServer([], { ...access, apiUrl: "not a url" }),
    []
  )
})
