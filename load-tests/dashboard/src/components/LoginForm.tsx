import { useState } from 'react'
import { apiLogin } from '../lib/api'
import type { AuthState } from '../types'

interface Props {
  auth: AuthState
  setAuth: (a: AuthState) => void
}

export function LoginForm({ auth, setAuth }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuth({ token: null, email: null, loading: true, error: null })
    try {
      const { access_token, user } = await apiLogin(email, password)
      setAuth({ token: access_token, email: user.email, loading: false, error: null })
    } catch (err: any) {
      setAuth({ token: null, email: null, loading: false, error: err.message })
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-white">Authenticate</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Sign in with your portal account to authorize load test requests
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@zamdevai.com"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {auth.error && (
          <p className="text-xs text-red-400 bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2">
            {auth.error}
          </p>
        )}

        <button
          type="submit"
          disabled={auth.loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
        >
          {auth.loading ? 'Signing in…' : 'Sign In & Start Testing'}
        </button>
      </form>

      <p className="text-xs text-gray-500">
        Uses your portal credentials — JWT is fetched automatically and attached to all
        load test requests.
      </p>
    </div>
  )
}
