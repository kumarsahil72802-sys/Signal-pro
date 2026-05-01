import { useEffect, useState } from 'react'

const Toast = ({ message, type = 'info', onClose, duration = 5000 }) => {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(onClose, 300)
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onClose])

  const styles = {
    info: 'bg-[#162a45] border-[#3d5f90] text-[#b8d4ff]',
    success: 'bg-[#173427] border-[#2e6f54] text-[#64f2b3]',
    warning: 'bg-[#3a2d10] border-[#7a6327] text-[#ffd56a]',
    error: 'bg-[#3b1b26] border-[#724055] text-[#ff8fa1]',
    signal: 'bg-[#2d230a] border-[#8b6c24] text-[#ffbe2e]'
  }

  const icons = {
    info: 'INFO',
    success: 'DONE',
    warning: 'WARN',
    error: 'ERR',
    signal: 'SIG'
  }

  if (!isVisible) {
    return (
      <div className="fixed top-20 right-4 sm:right-6 z-50 transform translate-x-full opacity-0 transition-all duration-300">
      <div className={`rounded-xl border shadow-lg px-4 py-3 flex items-center gap-3 min-w-[260px] ${styles[type]}`}>
        <span className="cc-mono text-[10px] font-bold tracking-wider">{icons[type]}</span>
        <p className="font-medium text-sm">{message}</p>
      </div>
      </div>
    )
  }

  return (
    <div className="fixed top-20 right-4 sm:right-6 z-50 transform transition-all duration-300 animate-slide-in">
      <div className={`rounded-xl border shadow-lg px-4 py-3 flex items-center gap-3 min-w-[260px] ${styles[type]}`}>
        <span className="cc-mono text-[10px] font-bold tracking-wider">{icons[type]}</span>
        <p className="font-medium text-sm">{message}</p>
        <button
          onClick={() => {
            setIsVisible(false)
            setTimeout(onClose, 300)
          }}
          className="ml-auto opacity-70 hover:opacity-100 transition-opacity"
        >
          x
        </button>
      </div>
    </div>
  )
}

export default Toast
