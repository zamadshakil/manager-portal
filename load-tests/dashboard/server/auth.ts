export interface AuthResult {
  access_token: string
  refresh_token: string
  user: { id: string; email: string }
}

export async function loginWithPassword(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error_description?: string
      msg?: string
    }
    throw new Error(
      err.error_description ?? err.msg ?? `Authentication failed (${res.status})`,
    )
  }

  return res.json() as Promise<AuthResult>
}
