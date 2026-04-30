import React, { useEffect, useState } from 'react';

const Toast = ({ message, type = 'info', onClose, duration = 5000 }) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const styles = {
    info: 'bg-blue-600 text-white',
    success: 'bg-green-600 text-white',
    warning: 'bg-yellow-500 text-white',
    error: 'bg-red-600 text-white',
    signal: 'bg-purple-600 text-white'
  };

  const icons = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    signal: '🚀'
  };

  if (!isVisible) {
    return (
      <div className="fixed top-20 right-6 z-50 transform translate-x-full opacity-0 transition-all duration-300">
        <div className={`rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 min-w-[280px] ${styles[type]}`}>
          <span className="text-xl">{icons[type]}</span>
          <p className="font-medium text-sm">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-20 right-6 z-50 transform transition-all duration-300 animate-slide-in">
      <div className={`rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 min-w-[280px] ${styles[type]}`}>
        <span className="text-xl">{icons[type]}</span>
        <p className="font-medium text-sm">{message}</p>
        <button 
          onClick={() => {
            setIsVisible(false);
            setTimeout(onClose, 300);
          }}
          className="ml-auto text-white/70 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default Toast;
