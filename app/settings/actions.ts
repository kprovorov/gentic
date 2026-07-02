"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { generateKeyPairSync } from "node:crypto"
import { Client } from "ssh2"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  repo: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/,
      "Use the format user/repo"
    ),
  environment_id: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .pipe(z.string().uuid().nullable()),
})

const idSchema = z.string().uuid()

const environmentCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

const environmentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ssh_host: z
    .string()
    .trim()
    .max(253)
    .transform((value) => (value.length > 0 ? value : null)),
  ssh_port: z.coerce.number().int().min(1).max(65535),
  ssh_user: z
    .string()
    .trim()
    .max(64)
    .transform((value) => (value.length > 0 ? value : null)),
})

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

async function getAuthenticatedSupabase() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub

  if (!userId) {
    redirect("/login")
  }

  return { supabase, userId }
}

export async function createProject(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedSupabase()
  const project = projectSchema.parse({
    name: getString(formData, "name"),
    repo: getString(formData, "repo"),
    environment_id: getString(formData, "environment_id"),
  })

  const { error } = await supabase.from("projects").insert({
    ...project,
    user_id: userId,
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/settings")
}

function sshBuffer(value: string | Buffer) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(buffer.length, 0)
  return Buffer.concat([length, buffer])
}

function sshMpint(base64UrlValue: string) {
  let buffer = Buffer.from(base64UrlValue, "base64url")

  while (buffer.length > 1 && buffer[0] === 0) {
    buffer = buffer.subarray(1)
  }

  if (buffer[0] && (buffer[0] & 0x80) !== 0) {
    buffer = Buffer.concat([Buffer.from([0]), buffer])
  }

  return sshBuffer(buffer)
}

function generateSshKeyPair(name: string) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
  })
  const publicJwk = publicKey.export({ format: "jwk" })
  const privatePem = privateKey.export({
    type: "pkcs1",
    format: "pem",
  })

  if (!publicJwk.e || !publicJwk.n) {
    throw new Error("Failed to generate SSH public key")
  }

  const keyType = "ssh-rsa"
  const publicKeyBody = Buffer.concat([
    sshBuffer(keyType),
    sshMpint(publicJwk.e),
    sshMpint(publicJwk.n),
  ]).toString("base64")
  const comment = name.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-")

  return {
    publicKey: `${keyType} ${publicKeyBody} gentic-${comment}`,
    privateKey: privatePem.toString(),
  }
}

export async function createEnvironment(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedSupabase()
  const environment = environmentCreateSchema.parse({
    name: getString(formData, "name"),
  })
  const keyPair = generateSshKeyPair(environment.name)

  const { error } = await supabase.from("environments").insert({
    name: environment.name,
    user_id: userId,
    public_key: keyPair.publicKey,
    private_key: keyPair.privateKey,
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/settings")
}

export async function updateEnvironment(formData: FormData) {
  const { supabase } = await getAuthenticatedSupabase()
  const id = idSchema.parse(getString(formData, "id"))
  const environment = environmentUpdateSchema.parse({
    name: getString(formData, "name"),
    ssh_host: getString(formData, "ssh_host"),
    ssh_port: getString(formData, "ssh_port"),
    ssh_user: getString(formData, "ssh_user"),
  })

  const { error } = await supabase
    .from("environments")
    .update({
      ...environment,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/settings")
}

export async function deleteEnvironment(formData: FormData) {
  const { supabase } = await getAuthenticatedSupabase()
  const id = idSchema.parse(getString(formData, "id"))

  const { error } = await supabase.from("environments").delete().eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/settings")
}

function testSshConnection({
  host,
  port,
  username,
  privateKey,
}: {
  host: string
  port: number
  username: string
  privateKey: string
}) {
  return new Promise<string>((resolve, reject) => {
    const client = new Client()
    const timeout = setTimeout(() => {
      client.end()
      reject(new Error("Connection timed out"))
    }, 15000)

    client
      .on("ready", () => {
        clearTimeout(timeout)
        client.end()
        resolve("SSH authentication succeeded")
      })
      .on("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      .connect({
        host,
        port,
        username,
        privateKey,
        readyTimeout: 15000,
      })
  })
}

export async function testEnvironmentConnection(formData: FormData) {
  const { supabase } = await getAuthenticatedSupabase()
  const id = idSchema.parse(getString(formData, "id"))

  const { data: environment, error } = await supabase
    .from("environments")
    .select("id,ssh_host,ssh_port,ssh_user,private_key")
    .eq("id", id)
    .single<{
      id: string
      ssh_host: string | null
      ssh_port: number
      ssh_user: string | null
      private_key: string
    }>()

  if (error) {
    throw new Error(error.message)
  }

  const testedAt = new Date().toISOString()

  if (!environment.ssh_host || !environment.ssh_user) {
    const { error: updateError } = await supabase
      .from("environments")
      .update({
        last_connection_status: "failed",
        last_connection_message: "Enter a host and SSH user before testing.",
        last_tested_at: testedAt,
        updated_at: testedAt,
      })
      .eq("id", id)

    if (updateError) {
      throw new Error(updateError.message)
    }

    revalidatePath("/settings")
    return
  }

  try {
    const message = await testSshConnection({
      host: environment.ssh_host,
      port: environment.ssh_port,
      username: environment.ssh_user,
      privateKey: environment.private_key,
    })

    const { error: updateError } = await supabase
      .from("environments")
      .update({
        last_connection_status: "success",
        last_connection_message: message,
        last_tested_at: testedAt,
        updated_at: testedAt,
      })
      .eq("id", id)

    if (updateError) {
      throw new Error(updateError.message)
    }
  } catch (connectionError) {
    const message =
      connectionError instanceof Error
        ? connectionError.message
        : "SSH connection failed"
    const { error: updateError } = await supabase
      .from("environments")
      .update({
        last_connection_status: "failed",
        last_connection_message: message.slice(0, 500),
        last_tested_at: testedAt,
        updated_at: testedAt,
      })
      .eq("id", id)

    if (updateError) {
      throw new Error(updateError.message)
    }
  }

  revalidatePath("/settings")
}

export async function updateProject(formData: FormData) {
  const { supabase } = await getAuthenticatedSupabase()
  const id = idSchema.parse(getString(formData, "id"))
  const project = projectSchema.parse({
    name: getString(formData, "name"),
    repo: getString(formData, "repo"),
    environment_id: getString(formData, "environment_id"),
  })

  const { error } = await supabase
    .from("projects")
    .update({
      ...project,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/settings")
}

export async function deleteProject(formData: FormData) {
  const { supabase } = await getAuthenticatedSupabase()
  const id = idSchema.parse(getString(formData, "id"))

  const { error } = await supabase.from("projects").delete().eq("id", id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath("/settings")
}
