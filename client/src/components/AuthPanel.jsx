import { useState } from 'react'

const emptyForm = { email: '', password: '' }

const AuthPanel = ({ authenticated, userEmail, loading, error, onLogin, onLogout }) => {
  const [form, setForm] = useState(emptyForm)

  const submit = async (event) => {
    event.preventDefault()
    if (loading) return
    await onLogin(form.email, form.password)
    setForm((prev) => ({ ...prev, password: '' }))
  }

  if (authenticated) {
    return (
      <div className="rounded-2xl border border-[#2a466d] bg-[linear-gradient(145deg,#11213a,#0f1d31)] p-4 shadow-[0_12px_30px_rgba(4,10,20,0.45)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[#8ea7cc]">Secure Session</p>
            <p className="text-sm text-[#d7e3f8] mt-1">
              Logged in as <span className="font-semibold text-white">{userEmail || 'admin'}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-[#203b61] text-[#d7e7ff] border border-[#3a5e8e] hover:bg-[#2a4a77] transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-[#5b3d29] bg-[linear-gradient(145deg,#2a2015,#1f1810)] p-4 shadow-[0_12px_30px_rgba(12,8,2,0.45)]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[#e6ba78]">Trader Login</p>
          <p className="text-sm text-[#f4dcb8] mt-1">Write actions are protected. Login to take trades.</p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <input
          type="email"
          required
          value={form.email}
          onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
          placeholder="Admin email"
          className="w-full rounded-xl border border-[#6b4f38] bg-[#16100a] px-3 py-2 text-sm text-[#fdeacd] placeholder:text-[#aa8a65] outline-none focus:border-[#f0b90b]"
        />
        <input
          type="password"
          required
          value={form.password}
          onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
          placeholder="Password"
          className="w-full rounded-xl border border-[#6b4f38] bg-[#16100a] px-3 py-2 text-sm text-[#fdeacd] placeholder:text-[#aa8a65] outline-none focus:border-[#f0b90b]"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl px-4 py-2 text-sm font-semibold bg-[#f0b90b] text-[#1b1409] hover:bg-[#f7c53b] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Signing in...' : 'Login'}
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-[#ff9fa9]">{error}</p>}
    </div>
  )
}

export default AuthPanel
